/**
 * 角色编辑器的公共草稿类型与固定选项。
 *
 * 这些结构只描述前端编辑状态，不会直接写入故事文件；保存时由组合控制器转换回 Core 类型。
 */
import type {
  StoryContactFile,
  StoryImportantRoleDefinition,
  StoryNormalRoleDefinition,
  StoryRolesFile
} from "@story-mgr/core"
import type { StoryAssetMetadata } from "@story-mgr/shared"

export type RolesTab = "normal" | "important"
export type ImportantRoleImageMode = "common" | "male" | "female"
export type ImageVariant = "raw" | "compress1" | "compress2"

export interface RoleAiDraft {
  compressQuality1Text: string
  compressQuality2Text: string
  globalPrompt: string
  imageHeightText: string
  imageWidthText: string
}

export interface NormalRoleDraft {
  contact_enabled: boolean
  contact_initial_favor: number
  contact_track: "none" | "romance" | "official" | "social"
  draftKey: string
  descr: string
  id: string
  img_compress_1: string
  img_compress_2: string
  img_raw: string
  name: string
  prompt: string
  selected: boolean
  xingge_id: string
  xingge_note: string
  zhiye: string
}

export interface ImportantRoleDraft {
  contact_enabled: boolean
  contact_initial_favor: number
  contact_track: "none" | "romance" | "official" | "social"
  draftKey: string
  descr: string
  descr_female: string
  descr_male: string
  id: string
  img_compress_1: string
  img_compress_2: string
  img_female_compress_1: string
  img_female_compress_2: string
  img_female_raw: string
  img_male_compress_1: string
  img_male_compress_2: string
  img_male_raw: string
  img_raw: string
  name: string
  prompt: string
  prompt_female: string
  prompt_male: string
  qufen_xingbie: boolean
  selected: boolean
  xingge: string
  xingge_id: string
  xingge_note: string
  zhiye: string
}

export interface RoleAssetState {
  error: string | null
  loading: boolean
  meta: StoryAssetMetadata | null
}

export interface RolePromptState {
  error: string | null
  loading: boolean
}

export interface ImagePreviewState {
  path: string
  title: string
  url: string
}

export interface ImportantRoleImageTask {
  mode: ImportantRoleImageMode
  role: ImportantRoleDraft
}

export const imageVariants: ImageVariant[] = ["raw", "compress1", "compress2"]
export const contactTrackOptions = [
  { label: "不加入联系人", value: "none" },
  { label: "恋爱", value: "romance" },
  { label: "政务", value: "official" },
  { label: "社交", value: "social" }
] as const

export interface StoryRolesEditorProps {
  contact: StoryContactFile
  roles: StoryRolesFile
  saveSuccessMessage?: string | null
  saving: boolean
  storyId: string
  storyTitle?: string
}

export interface StoryRolesEditorEmits {
  close: []
  save: [roles: StoryRolesFile]
}

export type StoryRolesEditorEmit = <Name extends keyof StoryRolesEditorEmits>(
  event: Name,
  ...args: StoryRolesEditorEmits[Name]
) => void
