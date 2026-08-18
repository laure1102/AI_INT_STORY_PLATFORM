/**
 * 故事圣经和应用 AI 设置的持久化 Schema。
 *
 * 设置文件只保存非敏感模型配置；API 密钥必须由服务端环境变量提供。
 */
import { z } from "zod"

export const storyBibleSchema = z.object({
  background: z.string().default(""),
  golden_finger: z.string().default(""),
  protagonist: z.string().default(""),
  world_rules: z.string().default(""),
  outline: z.string().default(""),
  current_arc: z.string().default(""),
  gameplay_design: z.string().default(""),
  style_guide: z.string().default(""),
  constraints: z.string().default("")
})

export const appAiProviderSettingsSchema = z.object({
  baseUrl: z.string().default(""),
  model: z.string().default("")
})

export const appAiAgentSettingsSchema = z.object({
  baseUrl: z.string().default(""),
  chiefEditorModel: z.string().default(""),
  plotPlannerModel: z.string().default(""),
  assetDesignerModel: z.string().default(""),
  eventWriterModel: z.string().default(""),
  scriptDoctorModel: z.string().default(""),
  consistencyCheckerModel: z.string().default(""),
  temperature: z.number().min(0).max(2).default(0.7)
})

export const appAiSettingsSchema = z.object({
  image: appAiProviderSettingsSchema.default({
    baseUrl: "",
    model: ""
  }),
  text: appAiProviderSettingsSchema.default({
    baseUrl: "",
    model: ""
  }),
  agent: appAiAgentSettingsSchema.default({
    baseUrl: "",
    chiefEditorModel: "",
    plotPlannerModel: "",
    assetDesignerModel: "",
    eventWriterModel: "",
    scriptDoctorModel: "",
    consistencyCheckerModel: "",
    temperature: 0.7
  })
})

export const appSettingsSchema = z.object({
  ai: appAiSettingsSchema.default({
    image: {
      baseUrl: "",
      model: ""
    },
    text: {
      baseUrl: "",
      model: ""
    },
    agent: {
      baseUrl: "",
      chiefEditorModel: "",
      plotPlannerModel: "",
      assetDesignerModel: "",
      eventWriterModel: "",
      scriptDoctorModel: "",
      consistencyCheckerModel: "",
      temperature: 0.7
    }
  })
})
