/**
 * 故事圣经和应用 AI 设置的持久化 Schema。
 *
 * 设置文件保存编辑器可配置的模型连接信息，包括 API 密钥。部署环境变量仍可在服务端覆盖这些值。
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
  apiKey: z.string().default(""),
  baseUrl: z.string().default(""),
  model: z.string().default("")
})

export const appAiAgentSettingsSchema = z.object({
  apiKey: z.string().default(""),
  baseUrl: z.string().default(""),
  evolutionModel: z.string().default(""),
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
    apiKey: "",
    baseUrl: "",
    model: ""
  }),
  text: appAiProviderSettingsSchema.default({
    apiKey: "",
    baseUrl: "",
    model: ""
  }),
  agent: appAiAgentSettingsSchema.default({
    apiKey: "",
    baseUrl: "",
    evolutionModel: "",
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
      apiKey: "",
      baseUrl: "",
      model: ""
    },
    text: {
      apiKey: "",
      baseUrl: "",
      model: ""
    },
    agent: {
      apiKey: "",
      baseUrl: "",
      evolutionModel: "",
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
