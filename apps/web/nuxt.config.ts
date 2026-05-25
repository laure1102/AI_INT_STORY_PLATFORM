export default defineNuxtConfig({
  compatibilityDate: "2025-01-01",
  devtools: { enabled: true },
  ssr: false,
  srcDir: "app/",
  css: ["~/assets/css/main.css"],
  modules: ["@pinia/nuxt"],
  build: {
    transpile: ["@story-mgr/core", "@story-mgr/shared"]
  },
  runtimeConfig: {
    public: {
      apiBase: process.env.NUXT_PUBLIC_API_BASE ?? "http://localhost:4000/api"
    }
  }
})
