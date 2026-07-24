import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('marketos', {
  openExternal: async (url) => {
    try {
      const result = await ipcRenderer.invoke('open-external', url);
      return result;
    } catch (error) {
      return { success: false, error: error.message };
    }
  },
});
