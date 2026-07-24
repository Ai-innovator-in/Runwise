interface Window {
  marketos?: {
    openExternal: (url: string) => Promise<{ success: boolean; error?: string }>;
  };
}
