# Transport / safety policy inventory (PHASE 6.7B.1A)

目标不是消灭所有代码常量，而是消灭散落和互相矛盾的业务规则。

本轮只建立目标政策模块和本清单。不改生产发布表单、首页、费用结果、application payload V1、Fraud 水位、system_config、已执行 migration、init.sql。

分类：

- **A 安全不变量** → 版本化 TypeScript policy + 服务端强制验证。禁止迁到 system_config。
- **B 产品枚举/能力矩阵** → `src/lib/transport/transportPolicy.ts`
- **C 运营参数** → 未来受控 system_config，必须服务端限界。本轮不改 system_config，不建后台页。
- **D UI 文案** → messages 三语。目标 travel/deliver 文案本轮只建契约 key，6.7B.1C 再替换生产文案。
- **E 数据库完整性** → migration CHECK / controlled RPC。本轮零 SQL。
- **F 纯布局值** → 留在组件，不要配置化。

---

## A. 安全不变量

| 文件 | 当前字段/规则 | 当前语义 | 与新产品冲突 | 应迁移到 | 最早 Phase | 提前修改风险 | 历史数据 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `src/lib/post-form/buildPayload.ts` | plate required if `car` / `motorbike` / `van` | Provider 机动车必须有车牌 | 水路船舶也会走 plate；V2 船舶不得假装机动车牌 | `transportPolicy.requiresPlate` | 6.7B.1C | 现网 van/car 发帖失败 | 历史 plate 仍可读 |
| `src/components/home/PublishBottomSheet.tsx` | 同上 plate 三模式 | 发布 UI 重复硬编码 | 同上；未含新 cargo 车型 | 同一 policy | 6.7B.1C | 发布中断 | 无 |
| `src/lib/post-payload.ts` | `isPassengerScene` = travel **或** deliver+`escort_seats>=1` | 把押货当成“载人场景” | Travel 只有 car 才有人数；Deliver 押货不是通用座位 | `safetyPolicy` + field visibility | 6.7B.1B | 费用/表单显隐一起变 | 历史 escort_seats 0–N |
| `src/lib/security/runFraudIntercept.ts` | `isPureCargoDemand` = deliver && escort===0 | 纯货运才跑时空冲突 | 与 V2 escort 0/1 兼容，但 travel 非 car 载人未覆盖 | 保留 Fraud 模块；只对齐 escort 语义 | 6.7D | 漏拦或误拦 | 影响 live intercept |
| `src/lib/post-intercept.ts` | cargo waterlevel 未验证 1 / 已验证 3 | 安全水位 | **不要**迁到 DB 配置 | 留在 Fraud/intercept | 不迁 | 被运营改坏 | 无 |
| `src/messages/*/ui.handover_shield_alert` | 交接核验姓名/电话映射/车型/颜色/车牌 | 载人/车辆身份 | 公共交通、水路不适用车牌句 | `passenger_identity_vehicle` / water / public 模块 | 6.7B.1C | 文案对公交用户错误 | 无 |
| 目标政策（本轮新增） | 非 car 禁止 peopleCapacity>0 | 步行/两轮/公交/水路不载人 | 当前发布对 travel **一律**显示人数 | `validateTransportCapability` | 6.7B.1B UI 仍未挂载；1C 发布 | 历史 travel+walking 可能有座位数字 | 读历史勿清零 |
| 目标政策 | Deliver Provider 无通用座位数；接受时确认合法乘坐位 | 押货确认不是帖子容量 | 当前 Provider deliver 可填 availablePassengerSeats 0–4 | application V2 + 6.7D accept | 6.7B.1B / 6.7D | 申请 payload 不兼容 | 无行 |

Fraud 水位、hard deny、audit fail-closed **保持代码不变量**，不进 system_config。

---

## B. 产品枚举 / 能力矩阵

| 文件 | 当前字段/规则 | 当前语义 | 冲突 | 应迁移到 | 最早 Phase | 提前风险 | 历史数据 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `src/lib/types.ts` | `TransportMode` 10 值含 `van`，无 ebike/水路/货车 | 运行时发帖枚举 | 与 V2 目标列表不一致 | **保留**；V2 另表 | 6.7B.1C 才扩运行枚举 | canonical/UI/DB 三重破裂 | van 必须继续可读 |
| `src/lib/posts.ts` | `TRANSPORT_MODES` 顺序固定 | 发布 select 数据源 | 新 mode 若替换数组会提前出现在生产 UI | **本轮不得改内容或顺序** | 6.7B.1C | 新船/货车出现在现网 | 顺序也影响测试快照 |
| `src/lib/post-payload.ts` | `POST_CATEGORIES` travel/deliver；`isDeliverOrTravel` | 路线类打包 | UI 文案仍是“人搭车/物搭车” | lane 文案 1C；类型可保留 | 6.7B.1C | 首页分类图标错位 | category 列不变 |
| `src/lib/post-form/usePostFormState.ts` | visibility：travel 显示 `max_companions`；deliver demand 显示 `escort_seats` 0–4；travel/押货显示 share_mode；路线类一律 luggage | 发布显隐 | 非 car 也显示人数；Deliver 押货上限 4；luggage 文案进 Deliver | `getTransportFieldVisibility` | 6.7B.1C | 表单字段消失/错显 | 草稿 state |
| `src/lib/post-form/usePostFormState.ts` | travel 把 `escort_seats` 写成 private?4:max_companions | 费用侧复用 escort 当人数 | Travel 人数应是 car peopleCapacity，不是 escort | 1B 费用取值审计 / 1C 表单 | 6.7B.1C | 费用跳变 | hash 含 escort_seats |
| `src/lib/post-form/usePostFormState.ts` | private → 强制 4 座 | 整车买断 | 非 car 不应有 4 座；Deliver 押货最多 1 | policy + fee 解耦 | 6.7B.1C | 费用/文案一起错 | 历史 share_mode=private |
| `src/components/post-form/DeliverTravelFields.tsx` | escort 0–4；companions 1–4 | 发布控件 | 与 V2 escort 0/1、仅 car 人数冲突 | 同上 | 6.7B.1C | 用户填了非法 V2 值 | 已发布数字 |
| `src/lib/matching/applicationPayload.ts` | travel `passengerCount`/`availablePassengerSeats` **强制 1–4**；任意 TransportMode | 未挂载申请契约 | 无人有小件非法；非 car 仍可报座位 | 6.7B.1B 改 V2 payload（本轮不改 V1） | 6.7B.1B | 已写测试会红 | 尚无 DB 行 |
| `src/lib/matching/matchRequestForm.ts` | 同上 + Deliver cargo 可全 0（若 escort>0） | 申请表单 | Deliver 必须大件>0；escort 应 0/1 | 6.7B.1B | 6.7B.1B | sheet 测试 | 无 |
| `src/lib/matching/applicationPayload.ts` | Deliver cargo 全 0 只要 escort>0 可通过 | “至少一个数量”含座位 | 与“Deliver 必须有大件”冲突 | 1B | 6.7B.1B | 申请语义 | 无 |
| `src/lib/post-form/providerMatch.ts` | travel 用 `max_companions`，deliver 用 `escort_seats` 做容量 | 旧 Route/Capacity | 无 runtime caller；语义过时 | 6.7D 决定复用/删 | 6.7D | 误接回大厅 | 参考实现 |
| `src/lib/security/runFraudIntercept.ts` | 叠座：travel `max_companions` else `escort_seats` | 容量拦截 | 非 car 座位会进入 stacking | 对齐 policy 后再动 | 6.7D | 漏拦超载 | live |
| `src/lib/posts.ts` vs `post-payload.ts` | 两份 `POST_CATEGORIES` 顺序不同 | 重复枚举 | 非运输冲突，但是散落 | 以后集中 category 模块 | 不本轮 | 低 | 无 |

内部 DB category 仍为 `travel` / `deliver`。目标 UI 语义（只在政策/文档）：

- travel = 「顺路捎人或捎小件」
- deliver = 「顺路捎大件」

---

## C. 运营参数

| 文件 | 规则 | 语义 | 冲突 | 去向 | Phase | 风险 | 历史 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `src/lib/post-fee.ts` | km*0.05/0.035，保底 3；2/3/4 座折扣 0.9/0.8/0.7；免费行李 units=seats*4；货系 0.25/0.45/0.75/1.5；door +2/+4 | 现网费用 | Travel 人数取 escort/share；Deliver 押货走 passenger 价 | **本轮不改数值**。1B 只审计取值；改公式另开费用 Phase | 以后 | 用户看到的价变了 | 已发布 fee_amount |
| `src/lib/post-payload.ts` | `BUMP_FEE_OPTIONS` 0/2/5/10 | 加价档 | 无 | 未来 system_config + 服务端白名单 | 不本轮 | 客户端伪造加价 | 无 |
| `src/lib/post-form/usePostFormState.ts` | waypoint 上限 10；time_buffer 0–120 | 表单限幅 | 无 | 运营参数 | 不本轮 | 低 | 无 |
| `src/messages` | 溢价上限 2.5 倍 | 文案+滑条 | 无 | 运营 | 不本轮 | 低 | 无 |
| `src/lib/matching/applicationPayload.ts` | message 300 | 申请备注 | 无 | 可留代码常量 | 不本轮 | 低 | 无 |
| `src/lib/post-intercept.ts` | 货运水位 1/3 | 安全 | **禁止**配置化 | 留代码 | 永不迁 DB | 绕过拦截 | live |

---

## D. UI 文案

| 文件 | 规则 | 语义 | 冲突 | 去向 | Phase | 风险 | 历史 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `src/messages/zh.json` `hall.category` / `home.categories` | travel「人搭车」「顺路捎人」；deliver「物搭车」「顺路捎物」 | 生产大厅/发布分类 | 目标：捎人或小件 / 捎大件；禁止继续用模糊「顺路同行 / 小件同行 / 大件载运」 | 1C 改三语；本轮新 key `transportPolicy.*` 未接线 | 6.7B.1C | 用户认知突变 | 无 |
| `src/messages` `post.category.travel` | 「结伴旅行」 | 详情 | 与 travel 小件无人场景不符 | 1C | 6.7B.1C | 低 | 无 |
| `src/messages` `publish.luggage` / `ui.has_luggage` | 「行李」用于路线类 | Deliver 大件也叫行李 | 大件应用 cargo 文案 | 1C | 6.7B.1C | 申请/发布用词混乱 | 无 |
| `src/messages` `matchRequest.*Seats` | 1–4 / 押货 0–4 | 未挂载 sheet | 与仅 car、押货 0/1 冲突 | 1B 改 key（仍不挂大厅） | 6.7B.1B | 仅测试/未来 UI | 无 |
| `src/messages` `ui.private_buyout_notice` | 买断剩余 4 座 | 整车 | 非 car / Deliver 不应 4 座 | 1C | 6.7B.1C | 费用预期 | 无 |

本轮新增、**未挂生产 UI** 的契约 key：`transportPolicy.travelTitle/Subtitle`、`deliverTitle/Subtitle`、`escortSeatConfirm`、`safety.unlistedRiskCatchall`。塞语为自然译文，无英文占位。

---

## E. 数据库完整性

只读 repo（未查询 live Supabase）：

| 结论 | 证据 |
| --- | --- |
| `posts.transport_mode` 是 **text + CHECK**，不是 Postgres ENUM | `supabase/posts_init.sql` 允许 null 或 walking/scooter/bicycle/motorbike/subway/bus/train/flight/car/**van** |
| 已执行 migration **没有**改该 CHECK | `supabase/migrations/` 内仅 `20260907000001` 在 view 中选出 `transport_mode`，无 ALTER CHECK |
| 无独立 `transport_mode` enum type | 全库 rg 无 `CREATE TYPE ... transport` |
| RPC 未硬编码 mode 列表 | `canonicalStage1.toRpcStage1Payload` **不含** `transport_mode` |
| canonical hash **不含** `transport_mode` | `hashCanonicalStage1` 含 category、escort_seats、行李件数、share/delivery，不含 mode |
| `public_posts_safe` **暴露** `transport_mode` | `20260907000001` view 列 + `src/lib/posts/publicPostSelect.ts` |
| 历史 posts / 旧 matches / 未来 contract snapshots 依赖该 text | 改 CHECK 或删 van 会让历史行校验失败；contract snapshot 为 jsonb，可能拷贝 mode |
| `init.sql` 冻结 | 本轮不得改 |

本轮：零 migration，不改已执行 SQL，不写 verify.sql，不操作 Supabase。

新 V2 mode（ebike、ferry、cargo_van 等）**不能**在改 CHECK 之前写入 posts，否则被现网约束拒绝。

---

## F. 纯布局值（保留在组件）

| 文件 | 值 | 不要配置化 |
| --- | --- | --- |
| `PublishBottomSheet.tsx` | `z-50`、`max-h-[88vh]`、`rounded-t-3xl`、把手 `w-12` | 视觉 |
| `PostCard.tsx` / `posts.ts` | 左绿/右紫边、`border-l-[3px]` | 卡片壳 |
| `DeliverTravelFields.tsx` | `inputClass`、途经点 `×` | 控件样式 |
| `MatchRequestSheet.tsx` | `sm:` 居中 / 底部 sheet | 未挂载组件布局 |
| `PublishBottomSheet.tsx` | 人数 stepper `h-11 w-11` | 触控尺寸 |

---

## 当前 6.7B 冲突（本轮不修）

全部留给 **6.7B.1B / 1C**。

| ID | 现象 | 文件 | 建议 Phase |
| --- | --- | --- | --- |
| C1 | Travel payload 强制 `passengerCount` 1–4 | `applicationPayload.ts` | 1B |
| C2 | Provider Travel 强制 `availablePassengerSeats` 1–4 | 同上 | 1B |
| C3 | 非 car 仍可选/可提交座位 | payload + sheet 用完整 `TRANSPORT_MODES` | 1B |
| C4 | Deliver Demand cargo 可全 0（escort>0 即可） | `applicationPayload.ts` | 1B |
| C5 | Deliver escort 字段名 `escortSeats`，范围 0–4 | payload / messages | 1B 对齐 `escortPassengerCount` 0/1 |
| C6 | Provider Deliver cargo 可全 0 | payload | 1B |
| C7 | `MatchRequestSheet` 在 render 阶段比较 `open` 后 `dispatch` | `MatchRequestSheet.tsx` | 1B |
| C8 | `targetPost.id` 变化可能保留旧草稿 | `matchRequestForm` / sheet | 1B |
| C9 | 输入后不清除 `serverErrorKey` | sheet props | 1B |
| C10 | dialog 无完整 focus trap | sheet | 1B |
| C11 | 若测试用 `git diff HEAD` 只能证明工作树干净 | 6.7B 测试目前是读工作树文件；1A 起相对基线必须显式比 `6866e7ca03fe9d905cf5d70918d94571e5e5100b` | 1A 已遵守 |
| C12 | `calculateFinalFee` Travel 人数 = private?4 : `escort_seats\|\|1` | `post-fee.ts` + form 把 companions 写入 escort | 1C（不改费率常数，只改取值来源需产品确认） |
| C13 | Deliver 旧 passenger-scene 与押货费用耦合 | `isPassengerScene` / fee | 1C |
| C14 | `share_mode` 与旧 Deliver 押货逻辑耦合 | form visibility + private→4 | 1C |
| C15 | 「luggage」文案泄漏到 Deliver | messages + sheet cargo 区块 | 1C / 1B sheet 文案 |

---

## 6.7B.1B / 1C 迁移顺序

**1B（仍不挂大厅，不改发布生产行为）**

1. 用本模块改 application payload V2：仅 car 人数；Travel 允许无人+小件；Deliver cargo>0；escort 0/1。
2. 修 MatchRequestSheet：render dispatch、草稿按 `targetPost.id` 重置、清除 server error、focus trap。
3. 申请 UI 改用 `getTransportFieldVisibility`；运输 select 用目标 lane 列表，不把 van 当新 Travel。
4. 不改 `TRANSPORT_MODES` 导出，避免发布表单提前出现新 mode。

**1C（生产文案 + 发布显隐，需产品确认）**

1. 三语替换 travel/deliver 标题与副说明（使用已建 key）。
2. 发布表单：仅 car 显示人数；非 car 服务端强制 0；Deliver Provider 去掉通用座位。
3. 新 mode 要先 **新 migration** 扩 CHECK，再改运行枚举；van 只读 + 引导 cargo_van，不批量改历史行。
4. 费用：先决定 Travel 人数取值（companions vs escort）和 Deliver 押货是否仍走 passenger 公式；**不要 silently 改费率常数**。
5. luggage vs cargo 文案拆分。

**不要在 1C 之前**把 Fraud 水位、安全边界、或 mode 列表写入 system_config。

---

## 扫描范围

`src/`、`supabase/migrations/`、`supabase/posts_init.sql`、`src/messages/{zh,en,sr}.json`、现有 `*.test.ts`。

已读实现（不只按名字猜测）：`types.ts`、`posts.ts`、`post-payload.ts`、`post-fee.ts`、`post-form/*`、`DeliverTravelFields.tsx`、`PublishBottomSheet.tsx`、`canonicalStage1.ts`、`canonicalPayloadHash.ts`、`runFraudIntercept.ts`、`post-intercept.ts`、`post-route-match.ts`、`route/*`、`matching/*`、`MatchRequestSheet.tsx`、`publicPostSelect.ts`、`posts_init.sql`、`20260907000001`、三语文案。
