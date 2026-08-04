/**
 * 新故事各领域文件的默认内容。
 *
 * 这些函数只创建普通对象，不访问磁盘。Store 创建故事时还会让 Core Schema 解析一次，确保默认值
 * 与持久化契约同步；这里不负责创建目录或提交事务。
 */
import type {
  AppSettingsFile,
  StoryDoingFile,
  StoryEventLocationFile,
  StoryNormalRolesDataFile,
  StoryPhoneConversationsFile,
  StoryPhoneFile,
  StoryReferFile,
  StorySceneFile,
  StoryShopFile
} from "@story-mgr/core"

/** @returns 使用 `player.money` 且没有分类/商品的新商城配置。 */
export function createDefaultStoryShop(): StoryShopFile {
  return { currency_value_key: "player.money", categories: [], products: [] }
}

/** @returns 所有手机资料库均为空的新手机配置。 */
export function createDefaultStoryPhone(): StoryPhoneFile {
  return {
    relationship_tracks: [],
    personality_library: [],
    talk_library: [],
    action_library: [],
    reply_library: [],
    player_quick_messages: [],
    contact_profiles: [],
    fallback_replies: {}
  }
}

/** @returns 不含会话的新连续手机剧情文件。 */
export function createDefaultStoryPhoneConversations(): StoryPhoneConversationsFile {
  return { conversations: [] }
}

/**
 * 创建内置玩家性别称谓库。
 *
 * @returns 带 male/female 别名和常用 `term.player.*` 词条的新配置。
 *
 * 默认词条让新故事能立即使用性别敏感模板；故事作者仍可在编辑器中修改或新增词条。
 */
export function createDefaultStoryRefer(): StoryReferFile {
  return {
    gender_value_key: "player.gender",
    gender_aliases: {
      male: ["男", "male", "m"],
      female: ["女", "female", "f"]
    },
    terms: [
      { id: "player.respect", label: "NPC尊称玩家", male: "先生", female: "女士", fallback: "贵客" },
      { id: "player.casual", label: "熟人称呼玩家", male: "哥", female: "姐", fallback: "朋友" },
      { id: "player.self", label: "玩家普通自称", male: "我", female: "我", fallback: "我" },
      { id: "player.self_proud", label: "玩家自信自称", male: "本少", female: "本小姐", fallback: "我" },
      { id: "player.ta", label: "玩家第三人称", male: "他", female: "她", fallback: "TA" },
      { id: "player.him_her", label: "玩家宾格/指代", male: "他", female: "她", fallback: "TA" },
      { id: "player.young_title", label: "年轻身份称呼", male: "少爷", female: "小姐", fallback: "贵客" }
    ]
  }
}

/** @returns 菜单和行动都为空的新 Doing 配置。 */
export function createDefaultStoryDoing(): StoryDoingFile {
  return { menus: [], doings: [] }
}

/** @returns 默认压缩质量为 60、无场景的新场景文件。 */
export function createDefaultStoryScenes(): StorySceneFile {
  return { ai: { compress_quality: 60 }, scenes: [] }
}

/** @returns 使用通用图片尺寸/质量且没有角色的新角色数据文件。 */
export function createDefaultStoryRoleData(): StoryNormalRolesDataFile {
  return {
    ai: {
      width: 1536,
      height: 1024,
      global_prompt: "",
      compress_quality_1: 60,
      compress_quality_2: 80
    },
    roles: []
  }
}

/** @returns 使用通用图片尺寸/质量且没有地点的新地点文件。 */
export function createDefaultStoryEventLocations(): StoryEventLocationFile {
  return {
    ai: {
      width: 1536,
      height: 1024,
      global_prompt: "",
      compress_quality_1: 60,
      compress_quality_2: 80
    },
    assignments: []
  }
}

/**
 * 创建不含密钥的应用设置。
 * @returns 文本、图片与六个 Agent 配置均为空，temperature 为 0.7 的设置。
 */
export function createDefaultAppSettings(): AppSettingsFile {
  return {
    ai: {
      image: { apiKey: "", baseUrl: "", model: "" },
      text: { apiKey: "", baseUrl: "", model: "" },
      agent: {
        apiKey: "",
        baseUrl: "",
        chiefEditorModel: "",
        plotPlannerModel: "",
        assetDesignerModel: "",
        eventWriterModel: "",
        scriptDoctorModel: "",
        consistencyCheckerModel: "",
        temperature: 0.7
      }
    }
  }
}
