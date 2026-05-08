/// <reference types="vite/client" />

declare module '*.sushi?url' {
  const url: string;
  export default url;
}

declare module '*.sushi?raw' {
  const content: string;
  export default content;
}
