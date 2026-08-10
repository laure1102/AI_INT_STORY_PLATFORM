/**
 * RuntimeStorySession 的稳定公共入口。
 *
 * 内部实现位于 session/ 目录；调用方统一从 @story-mgr/runtime 使用联系人领域名称。
 */
export type { RuntimeClockState } from "./clock"
export type { RuntimeRngState } from "./rng"
export type { RuntimeBagEntry, RuntimeBagState, RuntimeBagsState, RuntimeDoingRecord, RuntimeDoingState, RuntimeHistoryEntry, RuntimeLoopEventState, RuntimeContactEntryState, RuntimeContactMessageState, RuntimeContactState, RuntimeContactThreadState, RuntimePlaybackActionState, RuntimePlaybackState, RuntimePlayerProfileSetup, RuntimeProfileCustomFile, RuntimeScheduledEvent, RuntimeSchedulerAuditEntry, RuntimeSchedulerAuditKind, RuntimeSchedulerEventStatus, RuntimeSchedulerLoopState, RuntimeSchedulerSourceType, RuntimeSchedulerState, RuntimeShopGiftRecord, RuntimeShopPurchaseRecord, RuntimeShopState, RuntimeStorySaveState, RuntimeStorySessionSnapshot, RuntimeTriggeredOnceState } from "./session/contracts-core"
export type { CreateStorySessionOptions, RuntimeBagItemView, RuntimeBagSummary, RuntimeBranchOptionView, RuntimeDoingActionView, RuntimeDoingMenuView, RuntimeDoingView, RuntimeInteraction, RuntimeContactActionCostItemView, RuntimeContactActionView, RuntimeContactView, RuntimeContactQuickMessageView, RuntimeContactThreadMessageView, RuntimeContactThreadView, RuntimeRenderedDialogue, RuntimeRenderedMessage, RuntimeRuntimeContactConversationNodeView, RuntimeRuntimeContactConversationReplyView, RuntimeRuntimeContactConversationView, RuntimeShopCategoryView, RuntimeShopProductView, RuntimeShopView, RuntimeStoryBundle, RuntimeStorySession, RuntimeStorySessionAction, RuntimeStoryViewModel } from "./session/contracts-view"
export { createStorySession } from "./session/facade"
export { buildRuntimeContacts, buildRuntimeContactThreadView } from "./session/view-model"
