declare module "@koa/multer" {
  const koaMulter: typeof import("multer")["default"]
  export default koaMulter
}
