let extractor = null
const MODEL_CACHE = "story-semantic-v1"

/** 打开浏览器向量 IndexedDB 缓存。 */
function openCache() {
  return new Promise((resolve) => {
    if (!self.indexedDB) return resolve(null)
    const request = indexedDB.open(MODEL_CACHE, 1)
    request.onupgradeneeded = () => request.result.createObjectStore("vectors")
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => resolve(null)
  })
}

/** 读取已计算的文本向量。 */
async function cachedVector(key) {
  const db = await openCache()
  if (!db) return null
  return await new Promise((resolve) => {
    const request = db.transaction("vectors").objectStore("vectors").get(key)
    request.onsuccess = () => resolve(Array.isArray(request.result) ? request.result : null)
    request.onerror = () => resolve(null)
  })
}

/** 保存文本向量，避免重复推理。 */
async function storeVector(key, vector) {
  const db = await openCache()
  if (!db) return
  await new Promise((resolve) => {
    const request = db.transaction("vectors", "readwrite").objectStore("vectors").put(vector, key)
    request.onsuccess = request.onerror = () => resolve()
  })
}

/** 懒加载并复用 Transformers.js BGE pipeline。 */
async function getExtractor(modelId) {
  if (!extractor) {
    const module = await import("https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.2/+esm")
    module.env.useBrowserCache = true
    extractor = await module.pipeline("feature-extraction", modelId || "Xenova/bge-small-zh-v1.5", { quantized: true })
  }
  return extractor
}

self.onmessage = async (event) => {
  const request = event.data || {}
  try {
    const modelId = request.modelId || "Xenova/bge-small-zh-v1.5"
    const cacheKey = `${modelId}:${request.text || ""}`
    const cached = await cachedVector(cacheKey)
    if (cached) {
      self.postMessage({ id: request.id, vector: cached, cached: true })
      return
    }
    const pipeline = await getExtractor(modelId)
    const output = await pipeline(request.text || "", { pooling: "mean", normalize: true })
    const vector = Array.from(output.data)
    await storeVector(cacheKey, vector)
    self.postMessage({ id: request.id, vector })
  } catch (error) {
    self.postMessage({ id: request.id, error: error instanceof Error ? error.message : "语义模型加载失败。" })
  }
}
