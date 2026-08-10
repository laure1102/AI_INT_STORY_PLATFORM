/**
 * 完整 StoryDocument 的聚合 Schema。
 *
 * 读取旧故事时在这里接纳 graph/once/loop 字段，输出始终统一为
 * chainEvents、poolEvents 和 scheduleEvents。
 */
import { z } from "zod"
import {
  storyGameSettingsSchema,
  storyMetaSchema,
  storyPlayerOverrideValsSchema,
  storyReferSchema,
  storyValsSchema
} from "./base"
import {
  storyEventLocationSchema,
  storyItemsSchema,
  storyRolesSchema,
  storySceneSchema
} from "./assets"
import {
  storyInitialBagsSchema,
  storyShopSchema
} from "./commerce"
import {
  storyContactConversationsSchema,
  storyContactSchema
} from "./contact"
import { storyBibleSchema } from "./settings"
import {
  storyChainEventsSchema,
  storyDoingSchema,
  storyGraphEventsSchema,
  storyLoopEventsSchema,
  storyOnceEventsSchema,
  storyPoolEventsSchema,
  storyScheduleEventsSchema
} from "./events"

export const storyDocumentSchema = z.object({
  story: storyMetaSchema,
  storyBible: storyBibleSchema.default({}),
  vals: storyValsSchema,
  playerOverrideVals: storyPlayerOverrideValsSchema,
  systemVals: storyValsSchema,
  refer: storyReferSchema.default({}),
  scenes: storySceneSchema,
  roles: storyRolesSchema,
  eventLocations: storyEventLocationSchema,
  items: storyItemsSchema.default({}),
  shop: storyShopSchema.default({}),
  initialBags: storyInitialBagsSchema,
  contact: storyContactSchema.default({}),
  contactConversations: storyContactConversationsSchema.default({ conversations: [] }),
  doing: storyDoingSchema.default({}),
  chainEvents: storyChainEventsSchema.default([]),
  poolEvents: storyPoolEventsSchema.default([]),
  scheduleEvents: storyScheduleEventsSchema.default([]),
  graphEvents: storyGraphEventsSchema.default([]),
  onceEvents: storyOnceEventsSchema.default([]),
  loopEvents: storyLoopEventsSchema.default([])
}).transform((document) => {
  const chainEvents = document.chainEvents.length > 0 ? document.chainEvents : document.graphEvents
  const poolEvents = document.poolEvents.length > 0 ? document.poolEvents : document.onceEvents
  const scheduleEvents = document.scheduleEvents.length > 0 ? document.scheduleEvents : document.loopEvents

  return {
    story: document.story,
    storyBible: document.storyBible,
    vals: document.vals,
    playerOverrideVals: document.playerOverrideVals,
    systemVals: document.systemVals,
    refer: document.refer,
    scenes: document.scenes,
    roles: document.roles,
    eventLocations: document.eventLocations,
    items: document.items,
    shop: document.shop,
    initialBags: document.initialBags,
    contact: document.contact,
    contactConversations: document.contactConversations,
    doing: document.doing,
    chainEvents,
    poolEvents,
    scheduleEvents
  }
})

