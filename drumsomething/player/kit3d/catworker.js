// Web Worker que gera a malha do gato de pelúcia (catdetails.js) fora da
// thread da página, pra abrir a bateria 3D sem travar o player. Devolve só
// arrays, transferidos sem cópia.

import { catMeshData, meshDataBuffers } from "./catdetails.js";

self.onmessage = () => {
  const data = catMeshData();
  self.postMessage(data, meshDataBuffers(data));
};
