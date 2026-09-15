# MirioHub V1 匹配与履约技术规格 V2

> 状态：依据产品需求书 V3.1 形成的技术设计基线，待产品负责人确认后进入实施
>
> 编写日期：2026-09-13
>
> 产品事实来源：`MirioHub_V1_Product_Requirements_v3.1.md`
>
> 代码审阅基线：`feature/home-bottomsheet-fix` @ `a3945a54a6f6d379f0ab23020da34acb91667a5b`
>
> 数据库状态：v90–v98 已执行并冻结（v95 verify 69/69；v96 verify 78/78；
> PostGIS 已迁至 extensions；v97 verify 15/15 PASS；v98 verify 19/19 PASS）。
> PHASE 6.7C.2C.1 / v99A 新增**未 apply** 的只读 admission 权威对象：
> `match_request_admission_post_facts_v99`、`match_request_admission_facts_hash_v99`、
> `read_match_request_candidate_snapshot_v99`。不创建 `create_match_request_v99`，
> 不切换匹配 API。creation-enabled 仍为 false；夜间策略 RS seed 仍
> enabled=false。v98 发布路径仍把 origin_country_code / origin_timezone /
> night_policy_version 写为 NULL；v99A snapshot 可如实返回并哈希这些 NULL，
> 但不得推断国家或时区。下一阶段 `create_match_request_v99` 必须对新匹配
> fail closed：service_subtype NULL（legacy_unknown）、origin_country_code NULL、
> origin_timezone NULL、night_policy_version NULL 均不得创建新顺路请求。
> 不得改已部署的 v95 hash helper。v99 未执行，不得写成生产可用。

---

## 1. 文档权威性、范围与执行禁令

本文把产品需求书 V3.1 转换为数据库、服务端、API、状态机、并发锁、权限、隐私、计价、组合推荐、清理及测试设计。产品语义冲突时以 V3.1 为准；本文不得自行创造产品流程。

本文覆盖：

- 原生 Demand/Provider 双帖匹配；
- Travel、Deliver、Buy、Onsite；
- 单帖匹配、顺路方案估算、顺路请求及修订；
- 联系资料授权和四位沟通识别码；
- 接受、拒绝、合同形成、分段容量；
- 母行程、子订单、事件账本、送达确认、取消和争议；
- 组合推荐、收费权益、夜间规则、地点与地图链接；
- 外部冷启动信息的数据隔离边界；
- 数据保留、清理、RLS、ACL、日志和迁移策略。

本文不授权立即实现全部功能。进入代码阶段前必须把实施拆为小阶段，每阶段先核对 Git 与数据库基线，再只完成该阶段允许的范围。

在新技术阶段开始前必须遵守：

1. 不修改已经执行的 v90、v91、v92、v93、v94 和 `supabase/init.sql`；
2. 不执行当前仓库中的 v95；
3. 不新增 v96 来补救一个尚未执行的错误 v95；应先按本文重写 v95；
4. 不挂载旧 `MatchRequestSheet`，因为其 payload 和流程不是本文最终契约；
5. 不让浏览器直接写 Matching 私有表；
6. 不恢复旧 `confirm_match` 或任何客户端自报匹配结果的接口；
7. 不把“沟通邀请”和“正式顺路请求”实现为两个用户动作。

## 2. 当前实现审计与差距

### 2.1 可保留的基础

当前工程已经具备以下可复用基础：

- v93：双帖关系、联系邀请、联系授权、请求和合同基础表；
- v94：Provider 母行程状态、合同容量、合同当前状态投影、事件账本和安全清单；
- Cargo V2：Deliver 聚合空间、重量、押货人员及装卸意向契约；
- 路线：OSRM 插入路线估算及绝对/相对绕行阈值；
- 匹配：服务端统一准入骨架；
- 计价：现有 `post-fee.ts` 和 canonical Stage 1 中的服务端金额、minor-unit、规则版本及摘要思路；
- 联系码：服务端 pepper + HMAC、数据库仅存 hash 的思路；
- API：会话用户作为 actor、严格 unknown-key 拒绝、service-role RPC 的边界。

### 2.2 必须纠正的差距

| 当前实现 | V3.1 要求 | 技术处理 |
| --- | --- | --- |
| v95 只创建独立 contact invitation | 一个“发送顺路请求”同时创建请求、方案、联系授权及识别码 | 重写未执行 v95；一个原子 writer 完成首版请求 |
| 当前匹配准入要求日期和时间兼容 | 候选只硬过滤日期；时间差异用于提示和请求方案 | 修改共享 admission contract；时间合法但不作为候选兼容条件 |
| v95 有 `cold_start/mature` 联系披露模式 | 该产品开关已取消 | 不新增此模式；现有未执行 DDL 删除该配置 |
| v93 `request_assertion` 只是声明 stub | 最终请求需保存可修订方案 | 另建规范化修订表；不把全部历史塞回单一 JSON |
| v93 一对帖子只允许一个 pending request | 同一逻辑请求可多次修订，但只能有一个当前有效版本 | `match_requests` 作为线程，子表保存 revisions；当前指针唯一 |
| v94 仍含 `errand` 枚举 | Errand 已并入 Buy | 已执行枚举暂留为历史兼容；所有新 writer 禁止创建 `errand` |
| v94 Travel 容量把人数上限写死为 4 | 开放座位由 Provider 声明，不能硬编码 4 | 后续前向 migration 扩大数据库安全上限；业务上限来自配置/车型 |
| 旧 Deliver small/medium/large/xlarge | Deliver 使用聚合尺寸/重量 | 新 writer 只用 Cargo V2；旧字段仅供 Travel 小件 |
| 旧金额以 EUR 常量写死 | 按 Provider 起点国家、版本化配置计价 | 新建地区计价配置；服务端输出 minor units 与币种 |

### 2.3 关于 v93 表名的兼容解释

`match_contact_invitations` 已在线上存在，不能因产品不再显示“沟通邀请”而删除。它在新流程中降级为顺路请求内部的“联系安全信封”：保存参与双方、联系方式授权策略版本、识别码 hash、有效期和终态。前端永远不单独展示“邀请阶段”。

`contact_grants` 继续只保存谁可以通过哪些渠道查看谁的当前联系方式，不复制手机号、WhatsApp/Viber 账号或消息正文。

## 3. 核心领域模型

| 实体 | 含义 | 生命周期 |
| --- | --- | --- |
| `posts` | 用户发布的原始 Demand 或 Provider 意愿 | draft → active → matched/closed 等现有状态 |
| `match_requests` | 一对帖子之间由一个申请方发起的逻辑请求线程 | pending → accepted/rejected/invalidated/expired |
| `match_request_revisions` | 请求线程中的具体顺路方案；每次重发产生一条 | current → superseded，或 accepted/rejected/expired/invalidated |
| `match_contact_invitations` | 与请求线程一一对应的内部联系安全信封 | open → converted/invalidated/expired/blocked |
| `contact_grants` | 联系渠道访问授权，不存联系方式值 | live → revoked/expired |
| `match_contracts` | 被双方确认的独立子订单/合同 | formed → completed/cancelled |
| `provider_trip_state` | Provider 母行程是否尚可接单、已开始或结束 | open → started → ended |
| `contract_allocations` | 子订单在母行程分段上的权威容量占用 | active → released |
| `contract_events` | 只追加的履约事实账本 | append-only |
| `contract_state_projections` | 从事件推导的当前履约、保管、完成、取消、争议状态 | 事务内更新 |
| `safety_checklist_*` | 用户对关键步骤安全提示的勾选记录 | append-only acceptance |
| `external_listings` | 冷启动导入的外部信息 | imported → published → claimed/closed/expired |

核心关系：一张 Demand 帖子最多形成一个合同；一张 Provider 帖子可形成多个合同；每个合同绑定一张 Demand、一张 Provider、一个请求线程和一条被接受的请求修订。

## 4. 帖子契约升级

### 4.1 Travel 下级类型

帖子必须新增或规范化以下服务端字段，不能靠文案推断：

- Demand：`travel_demand_type` ∈ `passenger | small_item_only | passenger_with_small_item`；
- Provider：`travel_provider_type` ∈ `passenger_only | small_item_only | passenger_and_small_item`。

匹配矩阵由一个共享纯函数维护：

| Demand | Provider |
| --- | --- |
| `passenger` | `passenger_only`, `passenger_and_small_item` |
| `small_item_only` | `small_item_only`, `passenger_and_small_item` |
| `passenger_with_small_item` | `passenger_and_small_item` |

摩托车、步行、自行车、公交、火车、飞机和船只能发布 `small_item_only` Provider。船 V1 只允许捎带货物。汽车可发布三类。服务端必须复验交通方式与下级类型，客户端不得自动改类。

### 4.2 Deliver 运输能力

Deliver Provider 的车辆能力独立于 Travel transport mode，建议字段：

- `freight_vehicle_class`：`light | medium | heavy`；
- `freight_vehicle_type`：受控枚举，例如 `van | pickup | light_truck | box_truck | medium_truck | heavy_truck | other_freight`；
- Cargo V2 `availableSpace`、`availablePayloadKg`、`escortAccommodation`、装卸帮助布尔。

Deliver Demand 使用 Cargo V2 `requiredSpace`、重量 known/unknown、押货人数 0/1、装卸帮助布尔。装卸不一致只产生 advisory reason，不阻止候选、发送或接受。

### 4.3 Provider 母行程容量

汽车座位表单可以默认预填 4，但提交值必须由 Provider 确认。数据库只保存声明值；业务不得假设所有汽车均有 4 个开放座位。

独享请求占用该 Demand 重叠区间内 Provider 声明的全部开放乘客容量，不影响非重叠区间，也不必排斥不冲突的小件。

## 5. 地点与地图数据模型

### 5.1 标准地点目录

新建业务目录表，不使用 PostGIS `spatial_ref_sys`：

`place_catalog`

- `id uuid PK`
- `country_code char(2)`
- `admin1_code`, `admin2_code` nullable
- `canonical_name text`
- `normalized_name text`
- `aliases text[]` 或独立别名表
- `place_kind text`
- `center geography(Point,4326)` 或现有一致的地理类型
- `timezone_name text`
- `precision_m integer`
- `source_name`, `source_version`, `source_updated_at`
- `active boolean`

V1先导入塞尔维亚和实际需要的巴尔干地点。目录更新使用版本化批处理，不允许请求时从不受控互联网结果直接写入生产目录。

### 5.2 帖子地点

建议新建 `post_locations`，而不是继续给 `posts` 增加大量重复列：

- `id`, `post_id`
- `role`：`origin | waypoint | destination | pickup | dropoff | handoff | service_center | service_site`
- `stop_order`：Provider 起点 0、途经点递增、终点最大；非路线地点可为空
- `place_id`
- `display_label`
- `precision`：`locality | district | approximate | precise`
- `precise_point` nullable
- `map_provider` nullable
- `map_reference_hash` nullable；不保存不必要的原始链接
- `timezone_name`
- `created_at`

每个类别/角色允许的 `role` 组合由服务端 schema 校验。精确坐标属于私有字段，公开 DTO 只返回粗化地点。

### 5.3 精确地点解析

接口建议：`POST /api/locations/resolve-map-reference`。

输入只允许：帖子草稿上下文、标准地点 id、Google Maps 分享链接或 Plus Code。处理顺序：

1. 校验登录、body keys、长度和速率；
2. 分享链接只允许受控 Google Maps 域名；
3. 服务端请求禁止内网 IP、非 HTTPS、跨域无限重定向、超时和超大响应；
4. 能从链接可靠取得坐标则返回候选坐标和精度；
5. 否则要求 Plus Code；完整码本地解码，短码结合地区文字、`place_id` 中心或可靠链接参考点恢复；
6. 返回结果必须让用户确认，不能静默覆盖地点；
7. 原始链接、Plus Code、精确坐标不进入公开日志和分析事件。

### 5.4 粗略路线 DTO

匹配前服务端用精确点计算，但返回：

- `corridorLabels[]`：经过的城市、城区或较大社区；
- `coarseMapAnchors[]`：经过精度降级后的坐标；
- `canOpenCoarseRoute`；
- `precisionNoticeKey`。

`在地图中查看大致路线` 只向外部地图传粗略锚点及 Provider 明确公开的集合点。不得传私人住宅点、原始分享链接或 Plus Code。

## 6. 当地时间与夜间安全策略

### 6.1 时区来源

夜间判断优先使用出发地点/服务地点保存的 IANA `timezone_name`。若精确坐标存在，可由离线时区边界数据推导并与目录时区交叉检查；失败时不得退回用户设备时区。地点无法确定合法时区时，涉及夜间限制的帖子 fail closed，并提示补全地点。

### 6.2 配置

v96 建立 `night_service_policies`：`enabled`、IANA `timezone_name`、
`blocked_start_local` / `blocked_end_local`、`policy_version`、
`effective_from` / `effective_until`。`region_code` 为 NULL 表示国家默认。
字符串 CHECK 只保证 trim 后非空与长度，不宣称 `timezone_name` 已存在于
PostgreSQL 时区目录；未来受控 writer 必须用数据库时区能力校验 IANA 名。

当前数据库保证：同一 scope/version 不重复；同一 scope 最多一条
`effective_until IS NULL` 的 open-ended 策略。当前数据库尚不能完全阻止
不同版本的有限有效区间发生重叠（do not fully prevent overlapping bounded intervals）。不得宣称已有 exclusion constraint。
未来受控 writer 必须先关闭旧有效区间，再创建新版本。

时间区间必须支持跨午夜，例如 22:00–06:00。Travel/Deliver 无论 subtype
是否载人，都必须有合法 `transportMode`；NULL / 空字符串 / 未知值一律
`illegal_transport_combo`，夜间策略关闭也不能绕过。

### 6.2.1 确定性读取顺序

本阶段不创建生产读取函数。未来唯一合法选择顺序：

1. `enabled IS TRUE`
2. `effective_from <= evaluation_time`
3. `effective_until IS NULL OR evaluation_time < effective_until`
4. exact region_code 优先于 country default
5. 同一 scope 仍有多条候选时：`policy_version DESC`，然后
   `effective_from DESC`，然后 `id ASC`
6. 最终只取一条

### 6.3 适用矩阵

| 场景 | 夜间创建/发送/接受 |
| --- | --- |
| Travel Demand `passenger` | 拒绝 |
| Travel Demand `passenger_with_small_item` | 拒绝 |
| Travel Demand `small_item_only` | 允许 |
| Travel Provider `passenger` | 拒绝 |
| Travel Provider `passenger_with_small_item` | 拒绝 |
| Travel Provider `small_item_only` | 允许 |
| Deliver 押货 1 人 | 拒绝 |
| Deliver 押货 0 人 | 允许 |
| Onsite | 拒绝 |
| Buy | 允许 |

发布、重新估算、发送请求、接受请求都必须以各自事务时读取的最新配置复验；不得只靠发布时一次判断。

## 7. 单帖匹配准入

### 7.1 硬准入

共享 `matchAdmissionPolicy` 应只包含：

- 双帖存在且 active；
- 不同所有者；
- Demand/Provider 互补；
- 同一顶层类别；
- Travel 下级类型矩阵或 Deliver/Buy/Onsite 对应能力兼容；
- 严格日历日期合法且日期兼容；
- 交通/货运能力合法；
- 容量不存在明确不可能；
- 路线可计算且满足绝对绕行或相对绕行阈值；
- 配置完整合法。

候选准入不得要求双方时间窗口重叠。原有 `pairHasCompatibleSchedule` 必须拆成：

- `pairHasCompatibleDate`：硬准入；
- `describeTimeDifference`：排序/提示；
- `validateProposedSchedule`：发送和接受的合法性边界。

首发请求的准入事实与 `admission_facts_hash` 必须由同一条 SQL、同一次 `posts` 读取生成（MATERIALIZED CTE）。Hash 对已构造的 jsonb facts 计算，不再用裸 `|` 拼接，也不在 snapshot 内重新查询 `posts`。Writer 在锁帖后复用同一 facts/hash helper。浏览器不能提交或看到该 hash。该设计尚未在真实 PostgreSQL 并发环境验证。

### 7.2 路线公式

继续保留：

```text
admitted = extraDetourKm <= maxAbsoluteDetourKm
        OR extraDetourKm / providerBaselineKm <= maxRelativeDetourRatio
```

`calculateRouteMatchScore.ok` 只表示能计算插入路线，不等于已满足阈值。NaN、Infinity、负绕行、非法 baseline 或缺配置全部 fail closed。

### 7.3 匹配结果 DTO

浏览器只接收做决策所需的派生值：`matchPercent`、`extraDetourKm`、`extraMinutes`、时间差异提示、粗略走廊、容量摘要、价格 quote。浏览器不得提交 `matched`、score、阈值或 eligibility 作为授权事实。

## 8. 顺路方案估算

### 8.1 接口

`POST /api/matching/request-estimates`

请求：

- `initiatorPostId`
- `counterpartPostId`
- 建议日期和时间窗口
- 建议地点引用
- Demand 可选补贴档位 id
- `clientEstimateId`

人数、货物、角色、类别、Provider 容量不能由该请求改写，服务端从帖子读取。

响应：

- `estimateToken`：短期签名、不含秘密；
- `expiresAt`
- 日期/时间方案摘要；
- 精确点的安全显示标签；
- 绕行、增加时间、顺路度；
- 价格 breakdown、currency、pricingVersion；
- advisory reasons；
- 当前可发送与否。

估算不是预留、请求或合同，不写永久业务表。可使用短期服务端缓存；缓存 key 为用户、帖子版本、地点摘要、时间、补贴档位和配置版本。

### 8.2 防滥用

- 前端同输入只保留一个 in-flight 请求；
- 每一次到达服务端的调用均进入访问限流，缓存命中也计数；
- 路线真正发生变化的 OSRM 调用另设较低的昂贵计算额度；
- `estimateToken` 不能绕过发送时复验；
- 会员不免除安全限流；
- 错误不泄露对方精确地点、容量细节或风控原因。

## 9. 请求线程与修订数据模型

### 9.1 `match_requests` 的新职责

保留 v93 表作为逻辑线程。`request_version` 解释为 schema 版本，不再当用户可见的第几版。建议在未执行 v95 中增加：

- `current_revision_id uuid`，迁移中可先 nullable，建立子表后回填/新数据强制；
- `accepted_revision_id uuid nullable`；
- `terminal_reason text nullable`；
- 更严格的状态/时间戳双向不变量。

若循环 FK 使建表复杂，可让 revision 持有 request FK，再在 writer 中锁 request 并维护 `current_revision_id`；两个 FK 都使用 RESTRICT，不能 CASCADE。

### 9.2 新表 `match_request_revisions`

建议字段：

- `id uuid PK`
- `request_id uuid FK RESTRICT`
- `revision_no bigint`，仅内部使用
- `status`：`current | superseded | accepted | rejected | expired | invalidated`
- `superseded_at`, `responded_at`, `expires_at`
- `proposal_version integer`
- `proposal_payload jsonb`
- `pricing_version integer`
- `pricing_country_code char(2)`
- `pricing_currency char(3)`
- `base_amount_minor bigint`
- `bump_amount_minor bigint`
- `total_amount_minor bigint`
- `route_calculation_version integer`
- `match_percent numeric`
- `extra_detour_m integer`
- `extra_duration_seconds integer`
- `contact_preference text`
- `whatsapp_available boolean`
- `viber_available boolean`
- `created_at`

约束：

- UNIQUE `(request_id, revision_no)`；
- partial UNIQUE `(request_id) WHERE status='current'`；
- 金额为非负 safe range，`total = base + bump`；
- 三种金额币种与版本成组存在；
- status 与时间戳双向对应；
- JSON 必须为对象且由唯一 writer 递归拒绝未知/私人键；
- 不保存手机号到 revision；手机号从私有 profile 经 grant 按请求时读取；
- 不保存识别码明文。

`proposal_payload` 只保存被允许变更的建议日期、时间、起/终交接地点快照和可选说明。地点快照应是服务端生成的结构，不能保留不必要的原始地图 URL。

### 9.3 UI 的“最后一条有效”

列表 API 默认只返回当前 revision。历史消息若前端当前会话已经加载，收到新版状态后本地变灰并显示“已失效”；不展示版本号、不允许打开旧详情、不对灰色项发请求。服务端仍必须拒绝伪造的旧 revision 接受。

## 10. 发送与重发顺路请求

### 10.1 一个用户动作，一个事务

首发接口建议：`POST /api/matching/requests`。服务端最终调用一个 service-role-only SECURITY DEFINER RPC，在一个事务内：

1. 校验 session actor、strict body 和 idempotency key；
2. 先检查精确幂等重试；
3. 锁 actor 限流键；
4. 按 UUID 固定顺序 `FOR UPDATE` 锁双方帖子；
5. 读取并锁定 Provider 母行程状态；
6. 读取最新地点、配置、权益、请求上限；
7. 复验双帖、日期、路线、建议时间合法性和夜间规则；
8. 服务端重算路线和价格，不信任估算 token 内数值；
9. 创建 `match_contact_invitations` 内部安全信封；
10. 创建 `match_requests` 逻辑线程；
11. 创建首条 current revision；
12. 创建“申请方资料可供目标方查看”的 `contact_grants`；
13. 写入通知 outbox；
14. 返回最小成功 DTO 和四位识别码明文。

任何一步失败整事务回滚。不得先创建 invitation、再由另一个 API 创建 request，避免悬空数据。

### 10.2 重发

接口建议：`POST /api/matching/requests/{requestId}/revisions`。

只有原 `requester_user_id` 可重发。事务锁 request、current revision、双帖和母行程；复验仍 pending；将旧 current 改为 superseded，再插入新 current，最后更新 `current_revision_id`。旧 revision 不主动再推状态消息；新 revision 使用与首发相同的请求消息模板。

### 10.3 四位识别码

识别码用于确认线下联系对应本次平台请求，不是登录码、支付码、取件码或送达码。建议识别码绑定 `requestId + currentRevisionId + requesterUserId`，每次重发生成新的码，旧码随旧 revision 失效。

明文只在创建成功响应和目标方当前请求 DTO 中按授权返回；数据库只存 HMAC hash。日志、URL、analytics、错误和事件 payload 禁止出现明文。

## 11. 联系资料授权

首发或重发时申请方必须确认当前手机号，以及手机号是否可用于 WhatsApp/Viber，并选择首选方式 `phone | whatsapp | viber`。允许渠道至少包含首选方式。

`contact_grants` 仅保存渠道名和访问关系。读取接口每次执行：

1. 验证当前用户是 `viewer_user_id`；
2. grant 未撤销且未过期；
3. 请求 revision 仍是 current，或合同仍在允许披露阶段；
4. 从私有 profile 读取 subject 的当前联系方式；
5. 只返回 allowed channels 对应字段；
6. 终态 `terminal_privacy_at` 到达后停止返回手机号、WhatsApp/Viber、完整车牌、精确位置和委托联系人。

合同成立后另建双向合同期 grant，或让 DTO 根据合同参与者与投影直接授权；推荐继续使用显式 grant，便于撤销和审计。合同终结隐藏是 DTO 权限变化，不删除受保护合同快照。

## 12. 接受、拒绝和并发

### 12.1 接受接口

`POST /api/matching/requests/{requestId}/accept`

body 只允许 `currentRevisionId`、`clientActionId`。actor 必须是请求 recipient。事务锁顺序固定：

1. actor/advisory idempotency lock；
2. request；
3. current revision；
4. Demand/Provider posts，按 UUID 排序；
5. `provider_trip_state`；
6. Provider 现存 active allocations，按 segment/order/id；
7. Demand 现存 contract；
8. entitlement/usage row。

复验：

- request pending 且 revision 是当前有效项；
- actor 是 recipient；
- 双帖仍 active/可成单，Demand 尚无合同；
- Provider 母行程为 open；
- 日期、建议时间、夜间、路线、下级类型、Cargo/Travel 能力仍合法；
- 分段容量足够；
- 收费执行下 Provider 可形成新订单，或允许进入明确的待解锁流程；
- 请求未过期、未被外部状态取代。

成功事务：

- revision → accepted；request → accepted；invitation → converted；
- 创建 `match_contracts`，保存双原帖快照和 accepted proposal；
- 创建 `contract_allocations`；
- 创建 `contract_state_projections`；
- 创建/确认 `provider_trip_state`；
- 写 `contract_formed` 事件；
- 写双向合同期联系授权；
- Demand 帖子进入已匹配/不可再成单状态；
- Provider 帖子保持 active，直到母行程开始或容量/其他规则使其不再可接；
- 写通知 outbox；
- 返回合同 id。

其他 pending 请求无需主动逐条推送“失效”。它们在列表读取时由 Demand 已成单事实投影为不可操作；若目标方点击接受，事务返回明确 409 并将相关请求安全标记 invalidated。

### 12.2 拒绝

`POST /api/matching/requests/{requestId}/reject` 只允许 recipient 操作当前 revision。事务把 revision/request 标为 rejected，撤销请求期 grant，写通知 outbox。没有“暂不处理”状态。

### 12.3 不提供撤回动作

V1 不提供单独“撤回请求”按钮。申请方若关闭自己的帖子，读取或目标方尝试接受时，服务端根据帖子状态判定请求失效。已经形成合同后，关闭帖子不能代替合同取消。

## 13. 合同快照

合同必须保存三份受保护事实：

- `demand_snapshot`：接受时 Demand 原帖；
- `provider_snapshot`：接受时 Provider 原帖；
- `agreement_snapshot`：目标方接受的 current revision，包括最终日期、时间、地点、容量、服务条件、系统参考金额、补贴、币种、规则版本和必要的计算摘要。

请求阶段只保存稀疏地点选择：默认合作地点引用 Demand 原帖对应端点，不复制地址正文；覆盖尚未开放。接受事务（尚未实现）解析最终地点：

```text
finalLocation =
  request override
  ?? Demand 原帖对应地点
```

然后把完整最终地点写入 `match_contracts.agreement_snapshot`。请求阶段保存稀疏差异；合同阶段保存完整最终结果。Provider 原帖的 origin / waypoints / destination 只用于路线、顺路度和绕行，不是默认合作上下车或交接地点。

快照的作用不是允许帖子随意修改，而是：

- 一张 Provider 母行程可对应多个条件不同的子订单；
- 原帖以后关闭仍能证明双方当时确认了什么；
- 计价配置、地点目录和文案以后变化不改写历史合同；
- 争议、履约统计和客服不依赖可变帖子；
- 不把其他同行者的私密数据暴露给当前 Demand。

快照由服务端按 allowlist 组装，不复制不必要的身份证件、原始地图链接、验证码或其他合同参与者资料。产品所称长期/永久保留，技术上表示不进入普通请求清理；最终法定保存期限和用户数据权利仍需隐私政策单独约束。

## 14. 分段容量和母行程

Provider 路线建立有序 stop graph。每个合同分配 `[segment_from_order, segment_to_order)`。对每段分别累计：

- Travel：乘客单位和四档小件单位；
- Deliver：空间尺寸/体积、重量以及押货座位；
- Buy/Onsite：工作池占用单位。

接受事务必须锁母行程和相关 active allocations 后计算，不允许先查后写。组合计划不构成 reservation；实际接受仍使用同一原子容量 writer。

Provider 只对母行程执行一次 `start-trip`。状态从 open 到 started 后禁止再接受新合同。已开始后若 Provider 想承接剩余路程，必须自行发布新帖子；系统不生成“剩余行程”。

合同在开始前取消立即释放容量。已经上车、取件、购买或开始 Onsite 后，不得通过普通取消释放责任；必须进入送达、退回、双方同意终止或争议流程。争议中的货物保管继续占用工作池。

## 15. 计价系统

### 15.1 基本技术原则

- 所有金额使用整数 minor units；
- 币种由 Provider 母行程起点国家决定；
- 客户端不提交基础金额、币种、费率或总额；
- 估算和发送时服务端计算；接受时再计算或严格验证规则版本与输入摘要；
- 合同保存被接受的系统参考金额和规则版本；
- 不保存线下实际支付金额或币种；
- Demand 只能选择后台定义的 bump tier，不能输入任意金额。

### 15.2 配置表

建议建立 `pricing_policy_versions` 及受控 JSON/子表：

- `id`, `country_code`, `currency`, `version`, `effective_from`, `effective_to`, `status`；
- Travel 距离阶梯、最低金额；
- 乘客人数总系数；
- 独享系数；
- 小件单位权重、免费单位、超额系数、Travel 小件上限；
- Deliver 车辆等级每公里费率、最低金额、绕行费率；
- Deliver 空间/重量占用系数参数和上下限；
- 押货人员系数；
- bump tiers；
- rounding mode。

已生效版本不可原地修改，只能新建版本。管理员发布前做 schema 校验、范围校验和审计记录。

### 15.3 塞尔维亚 Travel 首版默认

- 前 100 km：6 RSD/km；
- 超过 100 km：4 RSD/km；
- 最低 350 RSD；
- 人数总系数：1→1.0、2→1.8、3→2.4、4→2.8；
- 小件单位：1/3/6/12；
- `passenger_with_small_item` 每名乘客免费 4 单位；
- `small_item_only` 免费单位为 0；
- 超额每单位为基础路线金额的 7.5%；
- 超出 Travel 小件上限时拒绝并引导 Deliver。

独享人数不是固定 4；按 Provider 对该区间声明的开放容量占用并应用配置系数。

### 15.4 Deliver 首版框架

- light：35 RSD/km，最低 500 RSD；
- medium：50 RSD/km，最低 800 RSD；
- heavy：70 RSD/km，最低 1200 RSD。

建议公式：

```text
commonLegAmount = max(minimum, commonDistanceKm × vehicleRate)
cargoFactor = clamp(max(volumeRatioFactor, weightRatioFactor), configuredMin, configuredMax)
detourAmount = extraDetourKm × vehicleDetourRate
escortAmount = escortPassengerCount × configuredEscortComponent
baseAmount = round(commonLegAmount × cargoFactor + detourAmount + escortAmount)
totalAmount = baseAmount + configuredDemandBump
```

`volumeRatioFactor` 和 `weightRatioFactor` 必须基于 Demand 需求与 Provider 当前可用能力，具体曲线做成配置并在实施 Deliver 计价前用测试样例确认，不能重新启用旧四档货物系数。装卸帮助费不进入公式。

### 15.5 Buy 与 Onsite

Buy/Onsite 不调用 Travel/Deliver 路线价格公式。它们保存发布者声明的价格条件：fixed/range/negotiable，以及独立的商品价、跑腿/服务费。接受快照保存当时公开条件，但不保存线下实际成交价。

## 16. 组合推荐

组合求解输入：一张 Provider 母行程、当前 eligible Demand 集合、路线 stop graph、每段容量、日期、时间建议、夜间规则、每条请求成本和权益。

组合必须联合验证所有成员，而不是先独立匹配再简单拼接。一个已生成的 A+B+C 组合在生成时应证明三者共同可行；A 被接受不能因为组合内容量计算遗漏导致 C 自相矛盾。外部订单抢占、Demand 被别的 Provider 接走、帖子关闭、方案改变、配置失效或母行程开始时，组合才变 stale。

组合结果是短期派生视图，不是合同、锁或容量预留。组合页只是外壳，每个 Demand 分别打开顺路请求弹窗、分别发送、分别接受。

权益：

- billing enforcement 关闭：所有用户获得自动组合、多组合比较和组合通知；
- billing enforcement 开启：会员获得上述能力；免费用户仍得到全部单帖候选、同等单帖计算和单帖通知；
- 服务端统一返回 capabilities，前端不自行读多个开关拼规则。

## 17. 收费、影子计量与待解锁请求

只需要一个收费执行总开关 `billing_enforcement_enabled`，从第一天始终进行 shadow metering。

服务端 entitlement resolver 输出：

- `canFormAnotherContract`
- `canUnlockPendingRequests`
- `canUseComboPlanner`
- `canReceiveComboNotifications`
- `remainingFormedOrderQuota`
- `remainingLockedRequestCapacity`

形成订单额度以 Provider 角色、计费周期、已成立订单及仍 active 的责任为核心。安全、Fraud、夜间、容量和争议不因会员放宽。

额度耗尽时 Demand 仍可看见 Provider 并发送请求；请求进入 locked-pending 状态或具有等价的 server projection。Provider只看到有新请求及升级/购买额度提示，不能读取申请方联系方式、发送联系动作或接受。达到后台配置的待解锁上限后，writer 拒绝再吸收新请求。Demand 端只显示未响应，不泄露 Provider 会员状态。

购买会员/额外额度与银行验证可共享付款凭证审核流程，但必须是两个独立结果：支付成功不自动宣称身份或银行账户已验证；若付款人选择提交本人凭证，可进入单独验证审查。

## 18. 履约状态机

### 18.1 母行程

`provider_trip_state`: `open → started → ended`。无“停止接新单”专用状态；用户不接受即可。started 后由服务端硬拒绝新合同。

### 18.2 子订单正交状态

沿用 v94 projection：

- execution：`not_started | in_progress | delivered_or_arrived | ended`；
- custody：`none | provider_holds_goods | returned | delivered`；
- completion：`open | one_side_declared | mutually_confirmed | code_confirmed | auto_completed`；
- cancellation：`none | requested | accepted | cancelled`；
- issue：`none | reported | disputed | resolved`。

状态不可由前端直接 PATCH。每个动作调用专用 writer，同时追加 `contract_events`、更新 projection 和必要的合同 lifecycle。

### 18.3 关键动作

- 母行程：开始一次、结束一次；
- Travel：乘客已接到、到达声明、完成确认；
- Deliver/Travel 小件：货物已交接/取件、送达声明、送达码确认、退回；
- Buy：购买开始、交付；
- Onsite：服务开始、完成；
- 问题：报告、争议打开、解决；
- 取消：开始前单方取消；受保护阶段仅双方同意或争议处理。

### 18.4 送达码

送达/完成码与联系识别码使用不同 domain separator、有效期和用途。Demand/收货方声明收到后才向 Provider 授权显示送达码。委托收货由 Demand 创建委托码；正常验证仍统一计入双方确认完成。

明文不进事件 payload。可保存 hash、生成者、用途、到期、使用时间和尝试计数。Provider 单方面声明送达不构成正常双方完成。

### 18.5 证据提示

平台不上传照片或文件。每个高风险动作要求读取当前版本 checklist，用户勾选后写 header + 至少一个 child item。数据库 DDL 无法单独保证 header 至少有一项，唯一 writer 必须在同事务写入 header 和非空 items。

## 19. 取消、临近取消与争议

开始前的单方取消事务：锁合同、projection、allocation；确认尚未接人/取件/购买/服务开始；追加事件；释放容量；关闭双方合同期 contact grant；设置隐私截止时间；计算是否临近取消。

临近取消依据“当前时间距离 accepted proposal 的计划开始时间”及版本化阈值，不依据用户是否点了开始。责任事实写入最小统计 ledger；权重算法读取配置，不回写篡改历史。

以下阶段拒绝普通取消：乘客已上车、Provider 持有货物/文件、商品已购买、Onsite 已开始、已送达待确认。此时只允许相应的送达、退回、双方同意终止或争议动作。

一方不回应时不能自动丢弃实质义务。货物未送达争议继续占用 Provider 工作池，并进入 Provider 完成率分母；最终由解决事件决定结果。

## 20. 通知与 Outbox

所有需要可靠发送的站内/邮件/push 事件必须在业务事务内写 `notification_outbox`，事务提交后异步 worker 发送，避免合同已成立但通知丢失。

事件至少包括：新顺路请求、新 current revision、请求接受/拒绝、合同成立、临近取消、开始、取件/接人、送达码可用、问题/争议、终态。其他请求因 Demand 已成单而失效时不主动群发；仅在列表读取或用户尝试操作时同步状态。

单帖通知与组合通知分开标记。单帖通知所有用户同等待遇；组合通知按统一 entitlement resolver。

通知 payload 只存内部 id 和模板 key，不存手机号、验证码、精确地点或消息全文。

## 21. 数据清理

清理 job 使用精确表、终态、截止时间、有限 batch 和 `FOR UPDATE SKIP LOCKED`。不使用 CASCADE，不扫描模糊表名前缀，不接受任意表名参数。

可清理：

- 未成单、已 superseded 的 request revisions；
- 未成单且 rejected/expired/invalidated 的请求线程及内部信封，在配置期限后且无合同/FK引用；
- 短期估算缓存；
- 已发送完成的 outbox 技术记录，按独立期限。

不可由请求清理删除：

- current pending request/revision；
- accepted revision；
- 任何合同引用的 request/invitation/post snapshot；
- active allocation；
- 履约中、保管中或争议中的合同及事件；
- 安全清单和已形成的最小履约统计事实。

清理前先 select count/ids 到审计摘要；delete 必须再次带状态、时间和 NOT EXISTS contract 条件。一次删除即可，不做产品层“两阶段清理”。

## 22. 外部冷启动信息

`external_listings` 与 `posts` 分表，但通过统一只读 candidate adapter 投影为前端近似卡片。至少保存：类别/角色、公开原文与结构化事实、外部平台、外部作者标识 hash、原始 URL、可能的私人联系方式（严格后台权限）、导入者、核验状态、claim 状态、有效期和匹配字段。

私人信息可为后续合规用途保存，但绝不进入公开 DTO、日志、前端 source 标记或原生用户联系授权。外部卡片前端不突出“未认领”或来源差异。

未认领 external listing 可以参与候选与组合展示，但不能创建平台合同、占用容量或计入信誉。外部↔外部匹配通过官方中转账号分别通知双方来平台查看；外部↔原生同时通知两端。双方至少进入平台后由本人点击跳转外部页面，平台不代发消息或直接互换私人联系方式。

认领 proof：平台生成 claim code，原作者从原外部账号发给官方中转账号；后台核验外部账号控制权。认领成功后将 external listing 绑定/转换为原生用户可控制帖子，后续合同正常进入履约历史。

## 23. API 与 RPC 清单

| 能力 | API | 原子数据库边界 |
| --- | --- | --- |
| 地图引用解析 | `POST /api/locations/resolve-map-reference` | 无业务写入或仅安全缓存 |
| 单帖匹配大厅 | `GET/POST /api/matching/hall` | 只读；服务端准入与路线 |
| 方案估算 | `POST /api/matching/request-estimates` | 短期缓存，不预留 |
| 首发请求 | `POST /api/matching/requests` | v95 原子 create writer |
| 重发方案 | `POST /api/matching/requests/{id}/revisions` | supersede + insert current |
| 收件/发件列表 | `GET /api/matching/requests?...` | role-scoped DTO |
| 读取联系资料 | `GET /api/matching/requests/{id}/contact` | grant + current state 复验 |
| 接受 | `POST /api/matching/requests/{id}/accept` | contract + allocation + event + grants |
| 拒绝 | `POST /api/matching/requests/{id}/reject` | request terminal + revoke grant |
| 母行程开始 | `POST /api/contracts/trips/{id}/start` | trip state + events |
| 子订单履约 | 专用 action endpoints | event + projection 原子更新 |
| 取消/争议 | 专用 action endpoints | 状态矩阵 writer |
| 组合推荐 | `GET/POST /api/matching/combinations` | 派生、短期缓存 |

每个 mutation RPC：SECURITY DEFINER、固定安全 `search_path`、显式 schema、PUBLIC/anon/authenticated 无 EXECUTE、仅 service_role；actor 由服务器会话传入，body 中不得接受 user id/role/owner。

## 24. RLS、ACL、隐私和日志

- Matching 私有表 ENABLE RLS，不向浏览器开放 policy 或 DML；
- API server 使用受控 service role 调用窄 RPC；
- RPC 逐项 re-read owner、role、status、配置和权限；
- 所有 body strict allowlist，递归拒绝联系人、GPS、车牌、验证码、费用伪造等未知字段；
- 公开 DTO、参与者 DTO、终态 DTO 分开定义，不能先返回全对象再由前端隐藏；
- 错误 key 不泄露对方精确失败原因；
- 日志只记录 request id、内部对象 id、固定事件名和错误分类；
- 手机、地图链接、Plus Code、精确坐标、车牌、识别码、送达码和消息正文禁止进入普通日志与 analytics；
- 管理员访问外部私人信息和争议数据必须有审计记录。

## 25. v95 重写边界

因为 v95 尚未执行，下一实施阶段应在原 v95 文件内重写，不创建 v96。v95 最小目标：

1. 删除未部署的 `matching_contact_mode` 及独立 invitation-only 产品语义；
2. 建立 `match_request_revisions` 与必要的 request 指针/约束；
3. 增加请求/估算/保留/额度所需受约束配置，但不把全部未来配置硬塞进 `system_configs`；
4. 创建首发顺路请求唯一原子 writer；
5. 创建只读 inspect 只能作为成本提示，不能授权成功；
6. writer 同时写 invitation、request、current revision 和申请方→目标方 grant；
7. 只返回 service-role 所需最小字段；
8. 不创建合同、不占容量、不修改 `posts.status`；
9. 将候选准入从日期+时间改为日期硬兼容，建议时间在 writer 验证；
10. 增加单一结果集 verify 和真实 PostgreSQL 前的静态/fixture 测试。

v95 不应一次承担接受成单、容量、履约和组合。那些能力分别作为后续 forward migration/RPC 阶段实现。

## 26. 迁移与发布顺序

1. **文档冻结**：确认 V3.1 与本文；
2. **代码差距测试**：先写能证明旧 v95/旧 admission 与本文冲突的失败测试；
3. **重写 v95**：仅请求创建基础，不执行；
4. **本地/临时 PostgreSQL 验证**：迁移、verify、并发和回滚；
5. **人工执行 v95**：只有 live v94 fingerprint 与表空/前提完全匹配时；
6. **远端 verify**：单结果集全 PASS；
7. **请求读写 API/UI**：挂载新 sheet，不复用旧 payload 假装兼容；
8. **修订与拒绝**；
9. **接受成单与容量事务**；
10. **履约事件与投影 writer**；
11. **地点精确化、计价配置与组合**按独立阶段接入；
12. **外部冷启动后台**最后与原生链路通过 adapter 对接。

每个阶段：确认 local/origin HEAD；不 merge main；只改白名单文件；targeted test、回归、tsc、lint 新增错误、build、diff-check；提交并 push；如涉及 migration，Cursor 不得自行连接 Supabase 或执行 SQL。

## 27. 测试矩阵

### 27.1 契约与输入

- Travel Demand/Provider 3×3 匹配矩阵；
- 交通方式只允许运货的边界；
- Deliver freight vehicle 与 Cargo V2；
- unknown/private key 递归拒绝；
- 严格日期、时区、跨午夜夜间判断；
- 候选日期兼容、时间不硬过滤；
- 建议时间发送/接受时合法性。

### 27.2 请求与并发

- exact idempotency；同 key 不同 payload 冲突；
- 同 pair 并发首发只产生一个线程；
- 重发时旧 current 原子 superseded；
- 旧 revision 接受失败；
- 接受与重发并发只有一个胜者；
- Demand 被两个 Provider 同时接受只有一个合同；
- Provider 分段容量并发不超卖；
- 母行程 start 与 accept 并发不产生 started 后新合同；
- 额度临界并发不超额。

### 27.3 隐私

- 无 grant 不返回联系方式；
- pending 只返回申请方允许渠道；
- contract 双向披露；terminal 后隐藏；
- 旧 revision 无详情；
- 错误、日志、outbox、events 无联系方式/码/精确地点；
- 粗略地图不含私人坐标。

### 27.4 金额

- 塞尔维亚阶梯/最低额/多人系数；
- 独享按声明容量而非固定 4；
- Travel 小件免费单位与上限；
- Deliver volume/weight factor 和未知重量确认；
- 跨境按 Provider 起点国家；
- bump tier 单独展示且总额相加；
- 客户端金额/币种伪造无效；
- 配置换版不改历史合同。

### 27.5 履约与清理

- 开始前取消释放；受保护阶段拒绝普通取消；
- 货物保管争议继续占用；
- 送达码与联系码不可混用；
- header + 非空 checklist items 原子写；
- 事件/projection/lifecycle 同事务；
- 清理只删除精确终态的未成单数据；
- accepted revision、合同快照、active/custody/dispute 数据永不被普通 cleanup 删除。

## 28. 可观测性与运营指标

从第一天记录但不泄露隐私：

- 匹配候选曝光、打开、估算、发送、接受、拒绝、过期；
- 原地点方案与路线附近方案的转化；
- 时间差异区间与接受率；
- 组合曝光、逐条请求及组合内成单数；
- Provider 周期 formed contracts、active obligations、locked pending；
- 额度触达、升级/额外额度购买；
- 临近取消、取件未送达、争议、正常完成；
- 路线服务失败率、缓存率、限流率；
- 外部 listing 导入、通知、访问、认领及认领后成单。

指标事件只保存枚举、bucket 和内部 id；不保存原始手机号、消息、地图链接或坐标。

## 29. 尚需在具体实施阶段确认的技术参数

以下不改变产品流程，可由受约束后台配置和测试默认值推进：

- 夜间起止时间及各国家例外；
- 请求有效期、旧 revision 清理期、终态未成单线程清理期；
- 估算/API/昂贵路线计算限流；
- free/member formed-order quota、locked-pending 上限；
- 临近取消阈值和权重参数；
- Deliver cargo factor 曲线；
- 精确地点粗化半径；
- 自动完成 72 小时的起算点和提醒节奏；
- 合同关键数据的法定保存期限。

这些参数不能由客户端决定；配置缺失或非法时涉及安全、金额、容量或授权的 writer 一律 fail closed。

## 30. 最终技术流程

```text
双方分别发布原帖
→ 服务端按日期、角色、类别、能力、容量和路线生成单帖候选
→ 时间差异只作提示
→ 申请方调整建议时间/地点并请求服务端估算
→ 单个原子 writer 创建联系安全信封、请求线程、current revision 和单向联系授权
→ 目标方查看申请方联系方式及四位识别码，可线下沟通
→ 原申请方如需修改则重发；旧 revision 原子失效
→ 目标方接受当前 revision
→ 原子创建合同、双原帖快照、最终方案快照、分段容量、投影、事件和双向联系授权
→ Provider 开始一次母行程
→ 各子订单分别接人/取件、送达、双方确认或送达码确认
→ 正常完成、开始前取消、退回、协商终止或争议
→ 终态 DTO 隐藏敏感信息
→ 普通清理只处理未成单终态请求，绝不触及合同关键事实
```

---

## 31. 下一步建议

在产品负责人确认本文没有语义偏差后，下一步不是直接实现全部系统，而是先执行“技术差距审计 + v95 重写计划”。该阶段只应：

1. 把本文规则转成可执行的 contract tests；
2. 列出 v95 当前 DDL/RPC/API 与本文逐项冲突；
3. 定义 `match_request_revisions` 最终 DDL 和首发原子 writer；
4. 明确哪些现有代码复用、修改或删除；
5. 输出下一阶段精确文件白名单、测试清单和停止点；
6. 不执行 SQL、不连接 Supabase、不挂载 UI。

只有该审计结果再次由产品负责人确认，才向 Cursor 下发第一段代码实施指令。
