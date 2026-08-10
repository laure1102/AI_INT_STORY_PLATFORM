/**
 * 角色编辑控制器：管理角色草稿、图片资产与批量任务。
 * 数据从弹窗 props 进入，保存时通过 emit 返回；外层弹窗开关不在这里处理。
 */
import type {
  StoryContactFile,
  StoryImportantRoleDefinition,
  StoryNormalRoleDefinition,
  StoryRolesFile
} from "@story-mgr/core"
import type { StoryAssetMetadata } from "@story-mgr/shared"
import { computed, reactive, shallowRef, watch } from "vue"
import { useStoryApi } from "../../composables/useStoryApi"

import { useStoryRoleDraft } from "./useStoryRoleDraft"
import {
  contactTrackOptions,
  imageVariants,
  type ImportantRoleDraft,
  type ImportantRoleImageMode,
  type ImportantRoleImageTask,
  type ImageVariant,
  type NormalRoleDraft,
  type StoryRolesEditorEmit,
  type StoryRolesEditorProps
} from "./storyRoleDraft"
export type {
  StoryRolesEditorEmits,
  StoryRolesEditorProps
} from "./storyRoleDraft"

/** 创建角色编辑器控制器；输出供模板消费，图片操作可能调用后端 API。 */
export function useStoryRolesEditor(
  props: Readonly<StoryRolesEditorProps>,
  emit: StoryRolesEditorEmit
) {

const {
  compressRoleImage,
  generateRoleImage,
  generateRolePrompt,
  getStoryAssetMeta,
  getStoryAssetUrl
} = useStoryApi()

const roleDraft = useStoryRoleDraft({ getStoryAssetMeta, getStoryAssetUrl, props })
const {
  activeTab, createRoleAiDraft, draft, assetStates,
  promptStates, promptEditorState, imagePreviewState, batchState,
  personalityOptions, createDraftKey, normalizeText, clampFavorInput,
  getPersonalityLabel, buildRoleXinggePromptText, sanitizeNameInput, parseCompressQualityInput,
  parseImageDimensionInput, createEmptyAssetState, createEmptyPromptState, getPromptStateKey,
  getAssetStateKey, initializeNormalRoleState, initializeImportantRoleState, clearRoleState,
  resetStates, getPromptState, getAssetState, cloneNormalRole,
  cloneImportantRole, formatBytes, formatAssetMeta, formatErrorMessage,
  getPromptPreview, applyRoleAiDraft, getActiveAiDraft, syncDraft,
  loadAssetMeta, hydrateAssetMeta, getImageVariantLabel, getRoleImageModeLabel,
  getImagePreviewTitle, getNormalAssetPath, setNormalAssetPath, getNormalAssetUrl,
  getImportantAssetPath, setImportantAssetPath, getImportantAssetUrl, openImagePreview,
  closeImagePreview, getImportantRolePrompt, setImportantRolePrompt, getNextDefaultId,
  getRoleDisplayName, addNormalRole, addImportantRole, removeNormalRole,
  removeImportantRole, openPromptEditor, closePromptEditor, savePromptEditor
} = roleDraft

const normalRoleCount = computed(() => draft.normalRoles.length)
const importantRoleCount = computed(() => draft.importantRoles.length)

const activeRoleCount = computed(() =>
  activeTab.value === "normal" ? normalRoleCount.value : importantRoleCount.value
)

const activeSelectedCount = computed(() =>
  activeTab.value === "normal"
    ? draft.normalRoles.filter((role) => role.selected).length
    : draft.importantRoles.filter((role) => role.selected).length
)

const allSelected = computed({
  get: () => activeRoleCount.value > 0 && activeSelectedCount.value === activeRoleCount.value,
  set: (checked: boolean) => {
    const source = activeTab.value === "normal" ? draft.normalRoles : draft.importantRoles
    for (const role of source) {
      role.selected = checked
    }
  }
})

const hasInvalidDraft = computed(() => {
  if (parseImageDimensionInput(draft.normalAi.imageWidthText) === null) return true
  if (parseImageDimensionInput(draft.normalAi.imageHeightText) === null) return true
  if (parseImageDimensionInput(draft.importantAi.imageWidthText) === null) return true
  if (parseImageDimensionInput(draft.importantAi.imageHeightText) === null) return true
  if (parseCompressQualityInput(draft.normalAi.compressQuality1Text) === null) return true
  if (parseCompressQualityInput(draft.normalAi.compressQuality2Text) === null) return true
  if (parseCompressQualityInput(draft.importantAi.compressQuality1Text) === null) return true
  if (parseCompressQualityInput(draft.importantAi.compressQuality2Text) === null) return true

  return (
    [...draft.normalRoles, ...draft.importantRoles].some((role) => !sanitizeNameInput(role.id))
  )
})

const hasActiveSelection = computed(() => activeSelectedCount.value > 0)
const isBatchRunning = computed(
  () =>
    batchState.generatingPrompts
    || batchState.generatingCommonImages
    || batchState.generatingMaleImages
    || batchState.generatingFemaleImages
    || batchState.compressing1
    || batchState.compressing2
)

const canBatchGeneratePrompts = computed(() => {
  if (!hasActiveSelection.value || isBatchRunning.value) {
    return false
  }

  return activeTab.value === "normal"
    ? draft.normalRoles.some((role) => role.selected && role.descr.trim())
    : draft.importantRoles.some(
        (role) =>
          role.selected
          && (role.qufen_xingbie
            ? role.descr_male.trim() || role.descr_female.trim()
            : role.descr.trim())
      )
})

const canBatchGenerateImages = computed(() => {
  const activeAiDraft = getActiveAiDraft()
  if (
    !hasActiveSelection.value
    || isBatchRunning.value
    || parseImageDimensionInput(activeAiDraft.imageWidthText) === null
    || parseImageDimensionInput(activeAiDraft.imageHeightText) === null
  ) {
    return false
  }

  return activeTab.value === "normal"
    ? draft.normalRoles.some((role) => role.selected && role.prompt.trim())
    : draft.importantRoles.some(
        (role) => role.selected && !role.qufen_xingbie && role.prompt.trim()
      )
})

const canBatchGenerateMaleImages = computed(() => {
  if (
    activeTab.value !== "important"
    || !hasActiveSelection.value
    || isBatchRunning.value
    || parseImageDimensionInput(draft.importantAi.imageWidthText) === null
    || parseImageDimensionInput(draft.importantAi.imageHeightText) === null
  ) {
    return false
  }

  return draft.importantRoles.some(
    (role) => role.selected && role.qufen_xingbie && role.prompt_male.trim()
  )
})

const canBatchGenerateFemaleImages = computed(() => {
  if (
    activeTab.value !== "important"
    || !hasActiveSelection.value
    || isBatchRunning.value
    || parseImageDimensionInput(draft.importantAi.imageWidthText) === null
    || parseImageDimensionInput(draft.importantAi.imageHeightText) === null
  ) {
    return false
  }

  return draft.importantRoles.some(
    (role) => role.selected && role.qufen_xingbie && role.prompt_female.trim()
  )
})

/** 判断 `hasNormalRawAsset` 对应的条件是否成立。 @param role 调用方传入的 `role`。 @returns 布尔判断结果。 */
function hasNormalRawAsset(role: NormalRoleDraft) {
  return role.img_raw.trim().length > 0
}

/** 判断 `hasImportantRawAsset` 对应的条件是否成立。 @param role 调用方传入的 `role`。 @returns 布尔判断结果。 */
function hasImportantRawAsset(role: ImportantRoleDraft) {
  if (role.qufen_xingbie) {
    return Boolean(role.img_male_raw.trim() || role.img_female_raw.trim())
  }

  return role.img_raw.trim().length > 0
}

const canBatchCompressImages1 = computed(() => {
  if (!hasActiveSelection.value || isBatchRunning.value) {
    return false
  }

  return activeTab.value === "normal"
    ? draft.normalRoles.some((role) => role.selected && hasNormalRawAsset(role))
    : draft.importantRoles.some((role) => role.selected && hasImportantRawAsset(role))
})

const canBatchCompressImages2 = computed(() => {
  if (!hasActiveSelection.value || isBatchRunning.value) {
    return false
  }

  return activeTab.value === "normal"
    ? draft.normalRoles.some((role) => role.selected && hasNormalRawAsset(role))
    : draft.importantRoles.some((role) => role.selected && hasImportantRawAsset(role))
})

/** 处理 `GenerateNormalPrompt` 用户交互。 @param role 调用方传入的 `role`。 @returns 无返回值；通过响应式状态、emit 或副作用体现结果。 */
async function handleGenerateNormalPrompt(role: NormalRoleDraft) {
  const state = getPromptState(role.draftKey)
  state.error = null
  state.loading = true

  try {
    role.prompt = await generateRolePrompt(props.storyId, {
      descr: role.descr,
      gender: "common",
      important: false,
      qufenXingbie: false,
      roleName: role.id,
      storyTitle: props.storyTitle,
      xingge: buildRoleXinggePromptText(role)
    })
  } catch (error) {
    state.error = formatErrorMessage(error, "生成提示词失败。")
  } finally {
    state.loading = false
  }
}

/** 处理 `GenerateImportantPrompt` 用户交互。 @param role 调用方传入的 `role`。 @returns 无返回值；通过响应式状态、emit 或副作用体现结果。 */
async function handleGenerateImportantPrompt(role: ImportantRoleDraft) {
  const state = getPromptState(role.draftKey)
  state.error = null
  state.loading = true

  try {
    if (role.qufen_xingbie) {
      const maleDescr = role.descr_male.trim()
      const femaleDescr = role.descr_female.trim()

      const [malePrompt, femalePrompt] = await Promise.all([
        maleDescr
          ? generateRolePrompt(props.storyId, {
              descr: maleDescr,
              gender: "male",
              important: true,
              qufenXingbie: true,
              roleName: role.id,
              storyTitle: props.storyTitle,
              xingge: buildRoleXinggePromptText(role)
            })
          : Promise.resolve(""),
        femaleDescr
          ? generateRolePrompt(props.storyId, {
              descr: femaleDescr,
              gender: "female",
              important: true,
              qufenXingbie: true,
              roleName: role.id,
              storyTitle: props.storyTitle,
              xingge: buildRoleXinggePromptText(role)
            })
          : Promise.resolve("")
      ])

      role.prompt = ""
      role.prompt_male = malePrompt
      role.prompt_female = femalePrompt
      return
    }

    role.prompt = await generateRolePrompt(props.storyId, {
      descr: role.descr,
      gender: "common",
      important: true,
      qufenXingbie: false,
      roleName: role.id,
      storyTitle: props.storyTitle,
      xingge: buildRoleXinggePromptText(role)
    })
    role.prompt_male = ""
    role.prompt_female = ""
  } catch (error) {
    state.error = formatErrorMessage(error, "生成提示词失败。")
  } finally {
    state.loading = false
  }
}

/** 处理 `GenerateNormalImage` 用户交互。 @param role 调用方传入的 `role`。 @returns 无返回值；通过响应式状态、emit 或副作用体现结果。 */
async function handleGenerateNormalImage(role: NormalRoleDraft) {
  const state = getAssetState(role.draftKey, "common", "raw")
  state.error = null
  state.loading = true
  const aiDraft = draft.normalAi

  try {
    const asset = await generateRoleImage(props.storyId, {
      gender: "common",
      globalPrompt: aiDraft.globalPrompt,
      width: parseImageDimensionInput(aiDraft.imageWidthText) ?? 1536,
      height: parseImageDimensionInput(aiDraft.imageHeightText) ?? 1024,
      prompt: role.prompt,
      targetName: sanitizeNameInput(role.id) || "normal_role"
    })

    setNormalAssetPath(role, "raw", asset.assetPath)
    state.meta = asset
  } catch (error) {
    state.error = formatErrorMessage(error, "生成图片失败。")
  } finally {
    state.loading = false
  }
}

/** 处理 `CompressNormalImage` 用户交互。 @param role 调用方传入的 `role`。 @param slot 调用方传入的 `slot`。 @returns 无返回值；通过响应式状态、emit 或副作用体现结果。 */
async function handleCompressNormalImage(role: NormalRoleDraft, slot: 1 | 2) {
  const variant: ImageVariant = slot === 1 ? "compress1" : "compress2"
  const state = getAssetState(role.draftKey, "common", variant)
  state.error = null
  state.loading = true
  const aiDraft = draft.normalAi

  try {
    const asset = await compressRoleImage(props.storyId, {
      quality:
        parseCompressQualityInput(
          slot === 1 ? aiDraft.compressQuality1Text : aiDraft.compressQuality2Text
        ) ?? (slot === 1 ? 60 : 30),
      slot,
      sourcePath: role.img_raw,
      targetName: sanitizeNameInput(role.id) || "normal_role"
    })

    setNormalAssetPath(role, variant, asset.assetPath)
    state.meta = asset
  } catch (error) {
    state.error = formatErrorMessage(error, `压缩图片${slot}失败。`)
  } finally {
    state.loading = false
  }
}

/** 读取或计算 `ImportantImageTargetName`。 @param role 调用方传入的 `role`。 @param mode 调用方传入的 `mode`。 @returns 计算、查找或构建后的结果。 */
function getImportantImageTargetName(role: ImportantRoleDraft, mode: ImportantRoleImageMode) {
  const baseName = sanitizeNameInput(role.id) || "important_role"
  if (mode === "male") return `${baseName}_male`
  if (mode === "female") return `${baseName}_female`
  return baseName
}

/** 处理 `GenerateImportantImage` 用户交互。 @param role 调用方传入的 `role`。 @param mode 调用方传入的 `mode`。 @returns 无返回值；通过响应式状态、emit 或副作用体现结果。 */
async function handleGenerateImportantImage(
  role: ImportantRoleDraft,
  mode: ImportantRoleImageMode
) {
  const state = getAssetState(role.draftKey, mode, "raw")
  state.error = null
  state.loading = true
  const aiDraft = draft.importantAi

  try {
    const asset = await generateRoleImage(props.storyId, {
      gender: mode,
      globalPrompt: aiDraft.globalPrompt,
      width: parseImageDimensionInput(aiDraft.imageWidthText) ?? 1536,
      height: parseImageDimensionInput(aiDraft.imageHeightText) ?? 1024,
      prompt: getImportantRolePrompt(role, mode),
      targetName: getImportantImageTargetName(role, mode)
    })

    setImportantAssetPath(role, mode, "raw", asset.assetPath)
    state.meta = asset
  } catch (error) {
    state.error = formatErrorMessage(error, `生成${getRoleImageModeLabel(mode)}失败。`)
  } finally {
    state.loading = false
  }
}

/** 处理 `CompressImportantImage` 用户交互。 @param role 调用方传入的 `role`。 @param mode 调用方传入的 `mode`。 @param slot 调用方传入的 `slot`。 @returns 无返回值；通过响应式状态、emit 或副作用体现结果。 */
async function handleCompressImportantImage(
  role: ImportantRoleDraft,
  mode: ImportantRoleImageMode,
  slot: 1 | 2
) {
  const variant: ImageVariant = slot === 1 ? "compress1" : "compress2"
  const state = getAssetState(role.draftKey, mode, variant)
  state.error = null
  state.loading = true
  const aiDraft = draft.importantAi

  try {
    const asset = await compressRoleImage(props.storyId, {
      quality:
        parseCompressQualityInput(
          slot === 1 ? aiDraft.compressQuality1Text : aiDraft.compressQuality2Text
        ) ?? (slot === 1 ? 60 : 30),
      slot,
      sourcePath: getImportantAssetPath(role, mode, "raw"),
      targetName: getImportantImageTargetName(role, mode)
    })

    setImportantAssetPath(role, mode, variant, asset.assetPath)
    state.meta = asset
  } catch (error) {
    state.error = formatErrorMessage(error, `压缩${getRoleImageModeLabel(mode)}${slot}失败。`)
  } finally {
    state.loading = false
  }
}

/** 处理 `BatchGeneratePrompts` 用户交互。 @returns 无返回值；通过响应式状态、emit 或副作用体现结果。 */
async function handleBatchGeneratePrompts() {
  if (activeTab.value === "normal") {
    const roles = draft.normalRoles.filter((role) => role.selected && role.descr.trim())
    if (!roles.length) return

    batchState.generatingPrompts = true
    batchState.promptDone = 0
    batchState.promptTotal = roles.length

    try {
      for (const role of roles) {
        await handleGenerateNormalPrompt(role)
        batchState.promptDone += 1
      }
    } finally {
      batchState.generatingPrompts = false
    }

    return
  }

  const roles = draft.importantRoles.filter(
    (role) =>
      role.selected
      && (role.qufen_xingbie
        ? role.descr_male.trim() || role.descr_female.trim()
        : role.descr.trim())
  )
  if (!roles.length) return

  batchState.generatingPrompts = true
  batchState.promptDone = 0
  batchState.promptTotal = roles.length

  try {
    for (const role of roles) {
      await handleGenerateImportantPrompt(role)
      batchState.promptDone += 1
    }
  } finally {
    batchState.generatingPrompts = false
  }
}

/** 处理 `BatchGenerateImages` 用户交互。 @param mode 调用方传入的 `mode`。 @returns 无返回值；通过响应式状态、emit 或副作用体现结果。 */
async function handleBatchGenerateImages(mode: ImportantRoleImageMode = "common") {
  if (activeTab.value === "normal") {
    const roles = draft.normalRoles.filter((role) => role.selected && role.prompt.trim())
    if (
      !roles.length
      || parseImageDimensionInput(draft.normalAi.imageWidthText) === null
      || parseImageDimensionInput(draft.normalAi.imageHeightText) === null
    ) {
      return
    }

    batchState.generatingCommonImages = true
    batchState.commonImageDone = 0
    batchState.commonImageTotal = roles.length

    try {
      for (const role of roles) {
        await handleGenerateNormalImage(role)
        batchState.commonImageDone += 1
      }
    } finally {
      batchState.generatingCommonImages = false
    }

    return
  }

  const roles = draft.importantRoles.filter((role) => {
    if (!role.selected) return false
    if (mode === "common") return !role.qufen_xingbie && role.prompt.trim()
    if (mode === "male") return role.qufen_xingbie && role.prompt_male.trim()
    return role.qufen_xingbie && role.prompt_female.trim()
  })

  if (
    !roles.length
    || parseImageDimensionInput(draft.importantAi.imageWidthText) === null
    || parseImageDimensionInput(draft.importantAi.imageHeightText) === null
  ) {
    return
  }

  if (mode === "common") {
    batchState.generatingCommonImages = true
    batchState.commonImageDone = 0
    batchState.commonImageTotal = roles.length
  } else if (mode === "male") {
    batchState.generatingMaleImages = true
    batchState.maleImageDone = 0
    batchState.maleImageTotal = roles.length
  } else {
    batchState.generatingFemaleImages = true
    batchState.femaleImageDone = 0
    batchState.femaleImageTotal = roles.length
  }

  try {
    for (const role of roles) {
      await handleGenerateImportantImage(role, mode)

      if (mode === "common") {
        batchState.commonImageDone += 1
      } else if (mode === "male") {
        batchState.maleImageDone += 1
      } else {
        batchState.femaleImageDone += 1
      }
    }
  } finally {
    if (mode === "common") {
      batchState.generatingCommonImages = false
    } else if (mode === "male") {
      batchState.generatingMaleImages = false
    } else {
      batchState.generatingFemaleImages = false
    }
  }
}

/** 处理 `BatchCompressImages` 用户交互。 @param slot 调用方传入的 `slot`。 @returns 无返回值；通过响应式状态、emit 或副作用体现结果。 */
async function handleBatchCompressImages(slot: 1 | 2) {
  if (activeTab.value === "normal") {
    const roles = draft.normalRoles.filter((role) => role.selected && role.img_raw.trim())
    if (!roles.length) return

    if (slot === 1) {
      batchState.compressing1 = true
      batchState.compress1Done = 0
      batchState.compress1Total = roles.length
    } else {
      batchState.compressing2 = true
      batchState.compress2Done = 0
      batchState.compress2Total = roles.length
    }

    try {
      for (const role of roles) {
        await handleCompressNormalImage(role, slot)
        if (slot === 1) {
          batchState.compress1Done += 1
        } else {
          batchState.compress2Done += 1
        }
      }
    } finally {
      if (slot === 1) {
        batchState.compressing1 = false
      } else {
        batchState.compressing2 = false
      }
    }

    return
  }

  const tasks: ImportantRoleImageTask[] = []

  for (const role of draft.importantRoles.filter((item) => item.selected)) {
    if (role.qufen_xingbie) {
      if (role.img_male_raw.trim()) {
        tasks.push({ mode: "male", role })
      }

      if (role.img_female_raw.trim()) {
        tasks.push({ mode: "female", role })
      }
      continue
    }

    if (role.img_raw.trim()) {
      tasks.push({ mode: "common", role })
    }
  }

  if (!tasks.length) return

  if (slot === 1) {
    batchState.compressing1 = true
    batchState.compress1Done = 0
    batchState.compress1Total = tasks.length
  } else {
    batchState.compressing2 = true
    batchState.compress2Done = 0
    batchState.compress2Total = tasks.length
  }

  try {
    for (const task of tasks) {
      await handleCompressImportantImage(task.role, task.mode, slot)
      if (slot === 1) {
        batchState.compress1Done += 1
      } else {
        batchState.compress2Done += 1
      }
    }
  } finally {
    if (slot === 1) {
      batchState.compressing1 = false
    } else {
      batchState.compressing2 = false
    }
  }
}

/** 校验当前草稿并提交给父组件或 API。 @returns 无返回值；通过响应式状态、emit 或副作用体现结果。 */
function submitDraft() {
  emit("save", {
    important: {
      ai: {
        compress_quality_1: parseCompressQualityInput(draft.importantAi.compressQuality1Text) ?? 60,
        compress_quality_2: parseCompressQualityInput(draft.importantAi.compressQuality2Text) ?? 30,
        global_prompt: draft.importantAi.globalPrompt.trim(),
        height: parseImageDimensionInput(draft.importantAi.imageHeightText) ?? 1024,
        width: parseImageDimensionInput(draft.importantAi.imageWidthText) ?? 1536
      },
      roles: draft.importantRoles.map((role) => {
        const isSplitByGender = role.qufen_xingbie

        return {
          descr: isSplitByGender ? "" : role.descr.trim(),
          descr_female: isSplitByGender ? role.descr_female.trim() : "",
          descr_male: isSplitByGender ? role.descr_male.trim() : "",
          img_compress_1: isSplitByGender ? "" : role.img_compress_1.trim(),
          img_compress_2: isSplitByGender ? "" : role.img_compress_2.trim(),
          img_female_compress_1: isSplitByGender ? role.img_female_compress_1.trim() : "",
          img_female_compress_2: isSplitByGender ? role.img_female_compress_2.trim() : "",
          img_female_raw: isSplitByGender ? role.img_female_raw.trim() : "",
          img_male_compress_1: isSplitByGender ? role.img_male_compress_1.trim() : "",
          img_male_compress_2: isSplitByGender ? role.img_male_compress_2.trim() : "",
          img_male_raw: isSplitByGender ? role.img_male_raw.trim() : "",
          img_raw: isSplitByGender ? "" : role.img_raw.trim(),
          name: role.name.trim(),
          id: sanitizeNameInput(role.id),
          prompt: isSplitByGender ? "" : role.prompt.trim(),
          prompt_female: isSplitByGender ? role.prompt_female.trim() : "",
          prompt_male: isSplitByGender ? role.prompt_male.trim() : "",
          contact_enabled: role.contact_enabled,
          contact_initial_favor: clampFavorInput(role.contact_initial_favor),
          contact_track: role.contact_track,
          qufen_xingbie: isSplitByGender,
          xingge: role.xingge.trim(),
          xingge_id: role.xingge_id.trim(),
          xingge_note: role.xingge_note.trim(),
          zhiye: role.zhiye.trim()
        }
      })
    },
    normal: {
      ai: {
        compress_quality_1: parseCompressQualityInput(draft.normalAi.compressQuality1Text) ?? 60,
        compress_quality_2: parseCompressQualityInput(draft.normalAi.compressQuality2Text) ?? 30,
        global_prompt: draft.normalAi.globalPrompt.trim(),
        height: parseImageDimensionInput(draft.normalAi.imageHeightText) ?? 1024,
        width: parseImageDimensionInput(draft.normalAi.imageWidthText) ?? 1536
      },
      roles: draft.normalRoles.map((role) => ({
        descr: role.descr.trim(),
        img_compress_1: role.img_compress_1.trim(),
        img_compress_2: role.img_compress_2.trim(),
        img_raw: role.img_raw.trim(),
        name: role.name.trim(),
        id: sanitizeNameInput(role.id),
        prompt: role.prompt.trim(),
        contact_enabled: role.contact_enabled,
        contact_initial_favor: clampFavorInput(role.contact_initial_favor),
        contact_track: role.contact_track,
        xingge_id: role.xingge_id.trim(),
        xingge_note: role.xingge_note.trim(),
        zhiye: role.zhiye.trim()
      }))
    }
  })
}

watch(
  () => props.roles,
  (roles) => {
    syncDraft(roles)
  },
  { immediate: true }
)

  return {
    imageVariants, contactTrackOptions, activeTab, createRoleAiDraft,
    draft, assetStates, promptStates, promptEditorState,
    imagePreviewState, batchState, personalityOptions, createDraftKey,
    normalizeText, clampFavorInput, getPersonalityLabel, buildRoleXinggePromptText,
    sanitizeNameInput, parseCompressQualityInput, parseImageDimensionInput, createEmptyAssetState,
    createEmptyPromptState, getPromptStateKey, getAssetStateKey, initializeNormalRoleState,
    initializeImportantRoleState, clearRoleState, resetStates, getPromptState,
    getAssetState, cloneNormalRole, cloneImportantRole, formatBytes,
    formatAssetMeta, formatErrorMessage, getPromptPreview, applyRoleAiDraft,
    getActiveAiDraft, syncDraft, loadAssetMeta, hydrateAssetMeta,
    getImageVariantLabel, getRoleImageModeLabel, getImagePreviewTitle, getNormalAssetPath,
    setNormalAssetPath, getNormalAssetUrl, getImportantAssetPath, setImportantAssetPath,
    getImportantAssetUrl, openImagePreview, closeImagePreview, getImportantRolePrompt,
    setImportantRolePrompt, getNextDefaultId, getRoleDisplayName, addNormalRole,
    addImportantRole, removeNormalRole, removeImportantRole, openPromptEditor,
    closePromptEditor, savePromptEditor, normalRoleCount, importantRoleCount,
    activeRoleCount, activeSelectedCount, allSelected, hasInvalidDraft,
    hasActiveSelection, isBatchRunning, canBatchGeneratePrompts, canBatchGenerateImages,
    canBatchGenerateMaleImages, canBatchGenerateFemaleImages, hasNormalRawAsset, hasImportantRawAsset,
    canBatchCompressImages1, canBatchCompressImages2, handleGenerateNormalPrompt, handleGenerateImportantPrompt,
    handleGenerateNormalImage, handleCompressNormalImage, getImportantImageTargetName, handleGenerateImportantImage,
    handleCompressImportantImage, handleBatchGeneratePrompts, handleBatchGenerateImages, handleBatchCompressImages,
    submitDraft
  }
}

/** 模板可以通过这个类型安全地访问控制器能力。 */
export type StoryRolesEditorController = ReturnType<typeof useStoryRolesEditor>
