# MirioHub V1 代码差距审计与 v95 重写计划 V1

> 审计日期：2026-09-13
>
> 产品事实来源：`MirioHub_V1_Product_Requirements_v3.1.md`
>
> 技术事实来源：`MirioHub_V1_Matching_Fulfillment_Technical_Spec_v2.md`
>
> Git 基线：`feature/home-bottomsheet-fix` @ `a3945a54a6f6d379f0ab23020da34acb91667a5b`
>
> 目的：在不执行 SQL、不修改代码的前提下，确定 v95 重写边界和后续实施顺序

---

## 1. 审计结论

当前工程不能直接进入“挂载 MatchRequestSheet”或“执行 v95”。原因不是现有代码质量差，而是产品流程在 v95 编写后发生了实质变化：用户不再先创建独立沟通邀请，再另行创建正式请求；现在只有一个“发送顺路请求”，它必须原子创建请求方案、联系安全信封、联系授权及当前有效修订。

因此，当前 v95 及其 API/test 是一套内部一致、但产品语义已经过期的实现。正确处理方式是：

1. v90–v94 保持冻结；
2. 当前 v95 尚未执行，原位重写，不新增 v96；
3. 先重写领域 contract 和数据库 schema/writer；
4. v95 经本地 PostgreSQL 与远端人工执行验证后，再开发读 API 和新 UI；
5. 接受成单、容量及履约不塞入 v95，另分后续阶段。

## 2. Git 与数据库事实

| 项目 | 当前事实 | 决议 |
| --- | --- | --- |
| branch | `feature/home-bottomsheet-fix` | 后续继续同一分支 |
| HEAD | `a3945a54...` | 第一条 Cursor 指令必须精确核对 local/origin |
| v90–v94 | 已执行、已形成线上 catalog | 禁止编辑 |
| v95 | 仓库存在、未执行 | 允许原位重写 |
| Supabase | 本审计不连接、不操作 | 代码阶段仍禁止 Cursor 自行执行 |
| MatchRequestSheet | 已写但未挂载 | 不直接挂载；未来重做 payload/交互 |
| legacy confirm_match | 已冻结并返回 409 | 继续冻结 |

## 3. 逐文件处置矩阵

### 3.1 v95 数据库文件

| 文件 | 处置 | 原因 |
| --- | --- | --- |
| `supabase/migrations/20260911000003_create_contact_invitation_boundary_v95.sql` | 全面重写 | 当前只创建 invitation，没有 request/revision/grant 原子性，并保留已取消的 disclosure mode 配置 |
| 同名 `.verify.sql` | 全面重写 | 当前只验证 invitation RPC 和旧配置，不能证明新请求 schema/writer |

迁移文件名可以保留，顶部说明应改为“create match request boundary”。文件名中的旧描述不影响迁移编号，但若仓库规则允许尚未执行 migration 改名，可在同一 commit 同步重命名主文件与 verify；不能同时留下两个 v95。

### 3.2 当前 invitation 运行时代码

| 文件 | 处置 | 可复用内容 |
| --- | --- | --- |
| `src/app/api/matching/contact-invitations/route.ts` | 删除或替换为 `/api/matching/requests` | auth、service client、safe error mapping 结构 |
| `contactInvitationCreate.ts` | 重写为 request create orchestration | strict body、writer row validation、固定 safe logs |
| `contactInvitationCreate.test.ts` | 重写 | idempotency、限流模拟骨架 |
| `contactInvitationBoundaryV95.test.ts` | 重写 | migration/RPC/ACL 静态边界检查 |
| `contactInvitationEligibility.ts/Core.ts` | 合并或删除薄 wrapper | 不应再拥有第二套 admission 规则 |
| `contactInvitationCode.ts/Core.ts` | 保留并改名/扩展 | HMAC domain separation、pepper 检查、四位码、hash 校验 |
| `contactInvitationCode.test.ts` | 保留并补 revision binding 测试 | 不泄露明文、确定性与域隔离 |

不得保留“旧 `/contact-invitations` API 兼容一阵”的伪兼容层。UI 尚未使用它，兼容只会制造两个入口。

### 3.3 匹配准入

| 文件 | 处置 | 具体修改 |
| --- | --- | --- |
| `matchAdmissionPolicy.ts` | 修改 | 把日期与时间拆开；候选只要求同日，时间产生 advisory |
| `matchAdmissionPolicy.test.ts` | 修改 | 删除“时间不兼容即候选失败”，新增时间差异仍可候选 |
| `matchAdmissionServer.ts` | 保留并扩展 | 继续负责 OSRM/阈值，增加服务端配置读取 |
| `buildMatchHall` 相关文件 | 修改 | 继续复用同一 admission；DTO 返回时间差异提示 |
| evaluate-route-match route | 修改 | 不把时间差异当 route-not-compatible |

必须避免从 `pairHasCompatibleSchedule` 简单改名但仍检查时间。建议明确函数：

- `validatePostScheduleFields`
- `pairHasCompatibleDate`
- `describePairTimeDifference`
- `validateProposedSchedule`

### 3.4 表单和 payload

| 文件 | 处置 | 原因 |
| --- | --- | --- |
| `MatchRequestSheet.tsx` | 保留 a11y 外壳，重写表单正文 | 现有字段不含最终建议地点/时间/补贴/contact preferences/estimate |
| `matchRequestForm.ts` | 重写契约 | 当前双向 Deliver wiring 可参考，但不满足完整 proposal |
| `applicationPayload.ts` | 不作为新请求主契约 | 旧 payload 不是 revision schema；避免伪兼容 |
| `applicationPayload.test.ts` | 保留历史回归或改名归档 | 不允许它限制新合法 revision 字段 |
| `matchRequestSheetBehavior.ts` | 保留 | focus trap、dismiss lock、safe focus 与产品语义无冲突 |
| `MatchRequestSheet.test.ts` | 后续扩充 | 当前只证明未挂载和旧表单/a11y；v95 阶段先不挂载 |

### 3.5 Travel/Deliver、金额和发布

| 文件 | 处置 | 具体差距 |
| --- | --- | --- |
| `transportPolicy.ts` | 修改 | 增加 Travel Demand/Provider 下级类型能力矩阵；Deliver 使用货运车辆体系 |
| `cargoContract.ts` / `cargoCompatibility.ts` | 保留 | Cargo V2 聚合申报、handling advisory 正确 |
| `post-fee.ts` | 废弃为生产唯一计价器 | EUR 常量与旧 Deliver 四档不符合新产品 |
| `canonicalStage1Core.ts` | 复用结构、改配置来源 | minor units/hash 可用；`bump_fee` 必须从自由金额变为 tier id |
| `PricePremiumSlider.tsx` | 删除或改为补贴档位选择器 | 用户不可任意拖动系统金额 |
| `DeliverTravelFields.tsx` | 后续修改 | 增加 Travel 双侧下级类型；Deliver 货运车型；补贴 tier |
| `usePostFormState.ts` / `buildPayload.ts` / `submitPost.ts` | 后续修改 | 保存新 subtype、货运能力、地点引用、配置化 bump |

## 4. 当前 v95 必须删除的语义

重写时必须完全删除：

- `matching_contact_mode`；
- `cold_start | mature` 联系披露分支；
- `recipient_contacts_initiator | mutual_eligible_contact` 作为运营模式选择；
- invitation-only writer；
- API 成功但没有 `match_requests` 的路径；
- 只传两个 post id 而无 proposed schedule/location 的请求；
- 候选阶段强制时间窗口重叠或相差不超过 30 分钟；
- “本阶段故意不写 match_requests/contact_grants”断言；
- 旧 route 名 `/api/matching/contact-invitations`；
- 与上述语义绑定的 messages keys 和 tests。

v93 已存在的 `disclosure_mode` NOT NULL 列不能删除。新 writer 对所有新请求统一写一个固定内部值，例如 `recipient_contacts_initiator`，仅满足已部署约束；它不再代表可切换产品模式。技术文档和注释必须说明这是 legacy storage value。

## 5. v95 新 DDL 边界

### 5.1 新表 `match_request_revisions`

建议最终字段：

| 字段 | 类型/约束 | 说明 |
| --- | --- | --- |
| `id` | uuid PK | revision id |
| `request_id` | uuid NOT NULL FK RESTRICT | 请求线程 |
| `revision_no` | bigint >0 | 内部序号，不在 UI 显示 |
| `status` | text enum | current/superseded/accepted/rejected/expired/invalidated |
| `proposal_version` | integer >0 | JSON schema version |
| `proposal_payload` | jsonb object | 服务端 canonical proposal |
| `pricing_version` | integer >0 | 规则版本 |
| `pricing_country_code` | char(2) | Provider 起点国家 |
| `pricing_currency` | char(3) | ISO currency |
| `base_amount_minor` | bigint >=0 | 系统基础参考金额 |
| `bump_tier_id` | text nullable | 后台配置档位 |
| `bump_amount_minor` | bigint >=0 | 服务端解析值 |
| `total_amount_minor` | bigint | base + bump |
| `match_percent_basis_points` | integer 0..10000 | 服务端结果 |
| `extra_detour_m` | integer >=0 | 不用浮点公里做权威值 |
| `extra_duration_seconds` | integer >=0 | 增加时间 |
| `contact_preference` | text enum | phone/whatsapp/viber |
| `whatsapp_available` | boolean | 联系渠道能力 |
| `viber_available` | boolean | 联系渠道能力 |
| `client_revision_id` | uuid | requester-scoped idempotency |
| `expires_at` | timestamptz | 当前请求有效期 |
| `superseded_at` | timestamptz nullable | 双向状态约束 |
| `responded_at` | timestamptz nullable | accepted/rejected |
| `created_at` | timestamptz | 服务器时间 |

约束和索引：

- UNIQUE `(request_id, revision_no)`；
- UNIQUE `(request_id, client_revision_id)`；
- partial UNIQUE `(request_id) WHERE status='current'`；
- index `(request_id, created_at DESC)`；
- index `(expires_at) WHERE status='current'`；
- status 与 `superseded_at/responded_at` 双向真值表；
- `total_amount_minor = base_amount_minor + bump_amount_minor`；
- revision 不能存手机号、地图原始 URL、Plus Code、识别码明文。

### 5.2 `match_requests` 增量

建议增加：

- `current_revision_id uuid`；
- `accepted_revision_id uuid nullable`。

由于 request 与 revision 形成循环引用，迁移顺序为：先建 revision 表及 request FK；再给 request 加 nullable 指针和 FK；新 writer 保证 current 指针存在。表当前为空，可在确认后设 NOT NULL；但需验证 PostgreSQL 循环 FK 的插入顺序，必要时将指针 FK 设 DEFERRABLE INITIALLY DEFERRED，而不是放弃 FK。

`request_version` 继续表示 request schema version，不与 `revision_no` 混用。

### 5.3 配置

v95 只添加请求创建所必需的配置：

- request TTL；
- 每帖 current/open 请求上限；
- actor 24h 创建上限；
- revision 每线程上限；
- contact policy version；
- route detour thresholds（若 v95 当前已计划且未部署，可保留）；
- estimate/request rate-limit 的业务上限可先在 server config，不必全塞 `system_configs`。

收费、国家完整计价、夜间、清理、组合配置不应为赶一次 migration 全部加入 v95。它们在对应功能阶段以版本化表实现。

### 5.4 RLS 与 ACL

新表：ENABLE RLS、不 FORCE；无 policy；REVOKE ALL FROM PUBLIC/anon/authenticated/service_role。所有 mutation RPC 只授予 service_role。UUID PK 不产生 sequence。

## 6. 首发 writer 契约

建议 RPC：

```text
create_match_request_v95(
  p_actor_user_id uuid,
  p_initiator_post_id uuid,
  p_counterpart_post_id uuid,
  p_client_request_id uuid,
  p_client_revision_id uuid,
  p_contact_code_hash text,
  p_proposal jsonb,
  p_server_quote jsonb,
  p_admission_digest text
)
```

这里 `p_proposal` 和 `p_server_quote` 只能由 API server canonical helper 生成，不能直接透传浏览器 JSON。数据库仍需验证顶层 keys、类型、金额关系、参与帖子和 digest；API 层递归拒绝未知/敏感字段。

更严格的选择是将关键金额/路线值做成独立 RPC 参数，减少 JSON。Cursor 在实施前应比较 PostgreSQL 函数可维护性，优先独立 typed 参数；只有地点 proposal 等结构化内容放 JSON。

返回：`request_id`、`revision_id`、`request_status`、`revision_status`、`expires_at`、`created`。四位明文由 server 在 writer 成功后加入 HTTP 响应，数据库永不返回明文。

## 7. 幂等与锁顺序

### 7.1 精确幂等

幂等键：`(requester_user_id, client_request_id)`。精确重试必须比较：initiator/counterpart、demand/provider 映射、client revision、code hash、proposal digest 和 server quote digest。

完全相同返回原 request/revision，`created=false`，不延长 TTL、不重复消耗限流、不重复建 grant。相同 key 但任何业务输入不同，返回 idempotency conflict。

### 7.2 锁顺序

1. actor-wide advisory lock；
2. `(actor, client_request_id)` advisory lock；
3. 查幂等现有 request `FOR UPDATE`；
4. miss 才锁双帖，按 UUID 排序；
5. 锁 Provider trip state；
6. 读取配置并重新计数；
7. 插入 invitation → request → revision → request current pointer → grant。

幂等命中应在帖子 active 复验之前返回，保证帖子后来关闭时同一网络重试仍能拿到原结果。但是否回传当前联系码必须验证当前 revision 尚有效；不能为已经 superseded/terminal 的旧重试重新披露码。

## 8. Proposal canonical schema

首版建议只支持已经完成基础契约的 Travel/Deliver。canonical proposal 按类别使用判别联合：

```text
TravelProposalV1
- category: travel
- proposedDate
- proposedTimeWindow
- pickupLocationSnapshot
- dropoffLocationSnapshot
- bumpTierId?
- note?

DeliverProposalV1
- category: deliver
- proposedDate
- proposedTimeWindow
- pickupLocationSnapshot
- deliveryLocationSnapshot
- bumpTierId?
- note?
```

人数、Travel subtype、Cargo requirement/capacity、Provider 可用容量全部从帖子和当前分段状态读取，不属于申请方可编辑 proposal。request revision 可以保存这些服务端 facts 的摘要用于接受时比对，但浏览器不能提交。

地点 snapshot 至少包括内部 resolved location id、坐标 digest、用户显示标签、precision 和 timezone；不保存原始 Google URL/Plus Code。

## 9. 联系授权的首版规则

首发成功同时创建一条申请方为 subject、目标方为 viewer 的 grant：

- `allowed_channels` 由 profile 当前手机号能力和本次表单确认共同生成；
- `preferred_channel` 必须属于 allowed；
- grant expiry 不晚于 request expiry；
- request 失效/拒绝时 revoke；
- request 重发不新建重复 grant，可延续同一线程但必须重新验证渠道；
- 合同成立后才创建反向 grant；
- 额度 locked-pending 时不得创建或不得激活可读 grant，具体由收费阶段扩展。

v95 API 仍不直接返回对方联系方式；请求列表/详情读 API 在下一阶段单独实现。

## 10. v95 阶段明确不做

- UI 挂载；
- incoming/outgoing 请求列表；
- 重发 revision writer；
- accept/reject；
- contract/allocations/events 写入；
- posts status 修改；
- 夜间配置 DDL；
- 国家计价 DDL；
- 组合推荐；
- 会员额度执行；
- 外部 listings；
- cleanup job；
- Supabase 自动执行。

原因：第一阶段只验证“首发顺路请求”的数据库原子边界。把接受和履约一起放入会使审计面过大。

## 11. 第一阶段允许文件白名单

建议 PHASE 6.7C.1B 只允许修改/新增：

1. v95 主 migration；
2. v95 verify；
3. `src/lib/matching/matchRequestCreateCore.ts`；
4. `src/lib/matching/matchRequestCreate.ts`；
5. 对应两份 test；
6. `contactInvitationCodeCore.ts` 及其 test（仅改 revision domain binding）；
7. `matchAdmissionPolicy.ts` 及 test（日期/时间拆分）；
8. `contactInvitationEligibility*` 删除或改为无第二套规则的兼容导出；
9. `src/app/api/matching/contact-invitations/route.ts` 删除；
10. `src/app/api/matching/requests/route.ts` 新增；
11. zh/en/sr error messages；
12. `docs/architecture/deferred-cleanup.md`；
13. 本审计确认后需要加入仓库的正式 architecture 文档。

不得修改：v90–v94、`init.sql`、MatchRequestSheet、PostCard、首页、Cargo V2、合同/容量 writer、Fraud、会员和支付。

## 12. 第一阶段验收测试

### 12.1 SQL/Schema

- v95 guard 精确验证 live v94 catalog 与目标表空状态；
- `match_request_revisions` 列、CHECK/FK/UNIQUE/index；
- 不存在多于一个 current revision；
- 状态/时间戳双向不变量；
- RLS on、FORCE off、policy 0、app-role DML 0；
- RPC service_role-only；
- verify 单 statement/单 result set；
- verify 不执行 writer、不泄露 prosrc/secret；
- v90–v94/init diff 为零；无 v96。

### 12.2 Runtime

- strict body，只接受 post ids、client ids、proposal input 和 contact preference；
- actor 只来自 session；
- 同日期不同时间仍 eligible；非法时间/夜间规则占位 fail closed；
- 两个 Travel subtype/Deliver category 不能混配；
- 服务器重算 route/quote；浏览器 score/amount/currency 被 unknown-key 拒绝；
- exact retry 返回原 row；collision 返回 409；
- inactive posts 的 exact network retry不重复创建；
- 非幂等新请求要求帖子 active；
- open/rate/revision limits 并发安全；
- invitation/request/revision/grant 任一步失败全回滚；
- 不写 contract/allocation/event/Fraud，不改 posts.status；
- 429/409 不返回 contact code；
- 成功后才返回 code；日志没有 code/hash/phone/location。

### 12.3 回归

- v93/v94 targeted；
- Cargo V2；
- transport policy；
- canonical Stage 1；
- match hall/route score；
- legacy matching freeze；
- security boundary/v92；
- MatchRequestSheet 仍未挂载；
- tsc；
- lint NEW errors = 0；
- build；
- `git diff --check`。

## 13. 迁移执行前人工门禁

Cursor 完成第一阶段后必须停止。产品负责人审阅 diff 和输出，再决定是否手工执行 v95。执行前：

1. 确认仓库与 origin commit；
2. 导出 live v94 catalog fixture；
3. 确认 v95 未存在于 migration history，相关新表/RPC不存在；
4. 确认 v93/v94 Matching 表仍满足迁移 guard 所需数据前提；
5. 在 SQL Editor 完整执行 v95 主文件；
6. 主文件成功后执行单结果 verify；
7. 所有 check PASS 才继续；
8. 任一失败保存完整错误/CSV，不局部手工补表，不跳 guard，不运行后半段。

## 14. 后续实施分段

| 阶段 | 交付 | 前置 |
| --- | --- | --- |
| 6.7C.1B | 重写 v95：首发请求原子边界 | 本文确认 |
| 6.7C.1B.1 | 修复未执行 v95 的幂等、稀疏地点、关系完整性和 fail-fast guard | 6.7C.1B 代码审计；v95 仍不可执行，需先导入 post-v94 live catalog CSV |
| 6.7C.2 | 请求列表、contact DTO、新 MatchRequestSheet 挂载 | v95 已验证 |
| 6.7C.3 | revision 重发与拒绝 | 列表稳定 |
| 6.7D.1 | accept 原子合同 + Demand 唯一性 | current revision 稳定 |
| 6.7D.2 | Provider trip + 分段容量 | accept contract |
| 6.7D.3 | 免费/会员额度与 locked pending | 容量稳定 |
| 6.8A | 开始、接人/取件、安全 checklist | 合同与容量稳定 |
| 6.8B | 送达码、委托收货、完成 | 履约动作稳定 |
| 6.8C | 取消、退回、争议、隐私终止 | 事件投影稳定 |
| 6.9A | 角色履约统计 | 终态事实稳定 |
| 后续 | 地点目录/精确地图、国家计价、组合、外部后台 | 各自独立规格 |

## 15. 当前停止点

这份审计完成后，尚未授权代码改动。下一步应由产品负责人先确认三个问题：

1. 是否同意把 v93 `match_contact_invitations` 仅作为内部“联系安全信封”，前端不展示独立邀请阶段；
2. 是否同意每次重发生成新的四位沟通识别码，使旧方案和旧码一起失效；
3. 是否同意第一轮 v95 只完成首发请求，不同时实现列表、重发、接受和 UI。

如果三项确认，即可生成一整块、可一次复制给 Cursor 的 PHASE 6.7C.1B 实施指令。
