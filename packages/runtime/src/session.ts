/**
 * RuntimeStorySession 的稳定公共入口。
 *
 * 内部实现位于 session/ 目录；调用方仍从 @story-mgr/runtime 使用原有名称。
 */
export type { RuntimeClockState } from "./clock"
export type { RuntimeRngState } from "./rng"
export type { RuntimeBagEntry, RuntimeBagState, RuntimeBagsState, RuntimeDoingRecord, RuntimeDoingState, RuntimeHistoryEntry, RuntimeLoopEventState, RuntimePhoneContactState, RuntimePhoneMessageState, RuntimePhoneState, RuntimePhoneThreadState, RuntimePlaybackActionState, RuntimePlaybackState, RuntimePlayerProfileSetup, RuntimeProfileCustomFile, RuntimeScheduledEvent, RuntimeSchedulerAuditEntry, RuntimeSchedulerAuditKind, RuntimeSchedulerEventStatus, RuntimeSchedulerLoopState, RuntimeSchedulerSourceType, RuntimeSchedulerState, RuntimeShopGiftRecord, RuntimeShopPurchaseRecord, RuntimeShopState, RuntimeStorySaveState, RuntimeStorySessionSnapshot, RuntimeTriggeredOnceState } from "./session/contracts-core"
export type { CreateStorySessionOptions, RuntimeBagItemView, RuntimeBagSummary, RuntimeBranchOptionView, RuntimeDoingActionView, RuntimeDoingMenuView, RuntimeDoingView, RuntimeInteraction, RuntimePhoneActionCostItemView, RuntimePhoneActionView, RuntimePhoneContactView, RuntimePhoneQuickMessageView, RuntimePhoneThreadMessageView, RuntimePhoneThreadView, RuntimeRenderedDialogue, RuntimeRenderedMessage, RuntimeRuntimePhoneConversationNodeView, RuntimeRuntimePhoneConversationReplyView, RuntimeRuntimePhoneConversationView, RuntimeShopCategoryView, RuntimeShopProductView, RuntimeShopView, RuntimeStoryBundle, RuntimeStorySession, RuntimeStorySessionAction, RuntimeStoryViewModel } from "./session/contracts-view"
export { createStorySession } from "./session/facade"
export { buildRuntimePhoneContacts, buildRuntimePhoneThreadView } from "./session/view-model"
