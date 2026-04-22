import { theme as antTheme, type ThemeConfig } from "antd";

export type AppThemeMode =
  | "light"
  | "dark"
  | "cyber"
  | "forge"
  | "forge-light"
  | "github"
  | "github-light"
  | "nord"
  | "solarized-light"
  | "gruvbox-dark"
  | "high-contrast"
  | "tokyo-night"
  | "solarized-dark"
  | "paper";

const sharedComponents: ThemeConfig["components"] = {
  Button: {
    fontWeight: 600,
    defaultShadow: "none",
    primaryShadow: "none",
    dangerShadow: "none"
  },
  Card: {
    bodyPadding: 16,
    headerPadding: 16
  },
  Timeline: {
    dotBorderWidth: 2
  }
};

export const lightAntdTheme: ThemeConfig = {
  algorithm: antTheme.defaultAlgorithm,
  token: {
    colorPrimary: "#1C8057",
    colorSuccess: "#3A8F63",
    colorWarning: "#E6B85C",
    colorError: "#C95C5C",
    colorInfo: "#6B8FA3",
    colorTextBase: "#444E39",
    colorBgBase: "#FBFDFC",
    colorPrimaryBg: "#ECF2EC",
    colorPrimaryBgHover: "#D1E4D6",
    colorPrimaryBorder: "#B6C5BA",
    colorPrimaryBorderHover: "#1C8057",
    colorPrimaryHover: "#166746",
    colorPrimaryActive: "#0F4F35",
    colorPrimaryText: "#1C8057",
    colorPrimaryTextHover: "#166746",
    colorPrimaryTextActive: "#0F4F35",
    colorSuccessBg: "#E8F3EA",
    colorSuccessBgHover: "#D1E4D6",
    colorSuccessBorder: "#B6C5BA",
    colorSuccessBorderHover: "#3A8F63",
    colorSuccessHover: "#2D7A4F",
    colorSuccessActive: "#1F6340",
    colorSuccessText: "#3A8F63",
    colorSuccessTextHover: "#2D7A4F",
    colorSuccessTextActive: "#1F6340",
    colorWarningBg: "#F9F3E6",
    colorWarningBgHover: "#F2E6C7",
    colorWarningBorder: "#E6D1A3",
    colorWarningBorderHover: "#E6B85C",
    colorWarningHover: "#D4A853",
    colorWarningActive: "#C2964A",
    colorWarningText: "#E6B85C",
    colorWarningTextHover: "#D4A853",
    colorWarningTextActive: "#C2964A",
    colorErrorBg: "#F7E6E6",
    colorErrorBgHover: "#ECD1D1",
    colorErrorBorder: "#E0B8B8",
    colorErrorBorderHover: "#C95C5C",
    colorErrorHover: "#B85353",
    colorErrorActive: "#A14747",
    colorErrorText: "#C95C5C",
    colorErrorTextHover: "#B85353",
    colorErrorTextActive: "#A14747",
    colorInfoBg: "#E8EDF0",
    colorInfoBgHover: "#D1DEE5",
    colorInfoBorder: "#B6C5BA",
    colorInfoBorderHover: "#6B8FA3",
    colorInfoHover: "#5A7D92",
    colorInfoActive: "#4B6B7E",
    colorInfoText: "#6B8FA3",
    colorInfoTextHover: "#5A7D92",
    colorInfoTextActive: "#4B6B7E",
    colorText: "#5A675D",
    colorTextSecondary: "#889C85",
    colorTextTertiary: "#A8B8A5",
    colorTextQuaternary: "#C9D4CC",
    colorTextDisabled: "#C9D4CC",
    colorTextPlaceholder: "#889C85",
    colorBgContainer: "#FFFFFF",
    colorBgElevated: "#FFFFFF",
    colorBgLayout: "#F4F8F5",
    colorBgSpotlight: "rgba(68, 78, 57, 0.85)",
    colorBgMask: "rgba(68, 78, 57, 0.45)",
    colorBorder: "#D1DED3",
    colorBorderSecondary: "#E8ECE9",
    borderRadius: 10,
    borderRadiusXS: 2,
    borderRadiusSM: 6,
    borderRadiusLG: 12,
    padding: 16,
    paddingSM: 12,
    paddingLG: 20,
    margin: 16,
    marginSM: 12,
    marginLG: 20,
    boxShadow: "none",
    boxShadowSecondary: "0 2px 8px 0 rgba(28, 39, 32, 0.08)"
  },
  components: {
    ...sharedComponents,
    Button: {
      ...sharedComponents?.Button,
      defaultBg: "#FFFFFF",
      defaultColor: "#5A675D",
      defaultBorderColor: "#D1DED3",
      defaultHoverBg: "#FFFFFF",
      defaultHoverColor: "#166746",
      defaultHoverBorderColor: "#1C8057",
      defaultActiveBg: "#FFFFFF",
      defaultActiveColor: "#0F4F35",
      defaultActiveBorderColor: "#0F4F35"
    },
    Card: {
      ...sharedComponents?.Card,
      headerBg: "#FFFFFF",
      extraColor: "#889C85"
    },
    Input: {
      hoverBorderColor: "#1C8057",
      activeBorderColor: "#1C8057",
      activeShadow: "0 0 0 1px rgba(28, 128, 87, 0.20)",
      hoverBg: "#FFFFFF",
      activeBg: "#FFFFFF"
    },
    Tag: {
      defaultBg: "#ECF2EC",
      defaultColor: "#1C8057"
    },
    Timeline: {
      ...sharedComponents?.Timeline,
      dotBg: "#1C8057",
      tailColor: "#D1DED3"
    },
    Progress: {
      defaultColor: "#1C8057",
      remainingColor: "#E8ECE9"
    }
  }
};

export const darkAntdTheme: ThemeConfig = {
  algorithm: antTheme.darkAlgorithm,
  token: {
    colorPrimary: "#67C496",
    colorSuccess: "#6AC28F",
    colorWarning: "#E1B458",
    colorError: "#D46C6C",
    colorInfo: "#89AEC3",
    colorTextBase: "#E2ECE3",
    colorBgBase: "#101613",
    colorPrimaryBg: "#163A29",
    colorPrimaryBgHover: "#1C4A34",
    colorPrimaryBorder: "#27543E",
    colorPrimaryBorderHover: "#67C496",
    colorPrimaryHover: "#7AD1A5",
    colorPrimaryActive: "#4CA87A",
    colorPrimaryText: "#8BE0AE",
    colorPrimaryTextHover: "#A0E7BF",
    colorPrimaryTextActive: "#67C496",
    colorSuccessBg: "#153523",
    colorSuccessBgHover: "#1B442E",
    colorSuccessBorder: "#27543E",
    colorSuccessBorderHover: "#6AC28F",
    colorSuccessHover: "#82D3A5",
    colorSuccessActive: "#58AF7E",
    colorSuccessText: "#8BE0AE",
    colorSuccessTextHover: "#A0E7BF",
    colorSuccessTextActive: "#67C496",
    colorWarningBg: "#352B17",
    colorWarningBgHover: "#45371D",
    colorWarningBorder: "#5B4823",
    colorWarningBorderHover: "#E1B458",
    colorWarningHover: "#ECC46F",
    colorWarningActive: "#C89A3F",
    colorWarningText: "#F0C97B",
    colorWarningTextHover: "#F5D591",
    colorWarningTextActive: "#E1B458",
    colorErrorBg: "#3A1F1F",
    colorErrorBgHover: "#482626",
    colorErrorBorder: "#613131",
    colorErrorBorderHover: "#D46C6C",
    colorErrorHover: "#DF8383",
    colorErrorActive: "#BE5D5D",
    colorErrorText: "#E79999",
    colorErrorTextHover: "#F0AEAE",
    colorErrorTextActive: "#D46C6C",
    colorInfoBg: "#162730",
    colorInfoBgHover: "#1C3340",
    colorInfoBorder: "#244353",
    colorInfoBorderHover: "#89AEC3",
    colorInfoHover: "#9ABDD0",
    colorInfoActive: "#7095AA",
    colorInfoText: "#A7C6D7",
    colorInfoTextHover: "#BAD6E4",
    colorInfoTextActive: "#89AEC3",
    colorText: "#D8E2D9",
    colorTextSecondary: "#9AAFA0",
    colorTextTertiary: "#7E9486",
    colorTextQuaternary: "#61786A",
    colorTextDisabled: "#61786A",
    colorTextPlaceholder: "#8AA092",
    colorBgContainer: "#171F1B",
    colorBgElevated: "#1B2520",
    colorBgLayout: "#0E1411",
    colorBgSpotlight: "rgba(13, 20, 17, 0.92)",
    colorBgMask: "rgba(0, 0, 0, 0.55)",
    colorBorder: "#2A3931",
    colorBorderSecondary: "#213028",
    borderRadius: 10,
    borderRadiusXS: 2,
    borderRadiusSM: 6,
    borderRadiusLG: 12,
    padding: 16,
    paddingSM: 12,
    paddingLG: 20,
    margin: 16,
    marginSM: 12,
    marginLG: 20,
    boxShadow: "none",
    boxShadowSecondary: "0 8px 24px rgba(0, 0, 0, 0.28)"
  },
  components: {
    ...sharedComponents,
    Button: {
      ...sharedComponents?.Button,
      defaultBg: "#171F1B",
      defaultColor: "#D8E2D9",
      defaultBorderColor: "#2A3931",
      defaultHoverBg: "#1D2722",
      defaultHoverColor: "#8BE0AE",
      defaultHoverBorderColor: "#67C496",
      defaultActiveBg: "#141C18",
      defaultActiveColor: "#67C496",
      defaultActiveBorderColor: "#4CA87A"
    },
    Card: {
      ...sharedComponents?.Card,
      headerBg: "#171F1B",
      extraColor: "#9AAFA0"
    },
    Input: {
      hoverBorderColor: "#67C496",
      activeBorderColor: "#67C496",
      activeShadow: "0 0 0 1px rgba(103, 196, 150, 0.24)",
      hoverBg: "#101613",
      activeBg: "#101613"
    },
    Tag: {
      defaultBg: "#173424",
      defaultColor: "#8BE0AE"
    },
    Timeline: {
      ...sharedComponents?.Timeline,
      dotBg: "#67C496",
      tailColor: "#2A3931"
    },
    Progress: {
      defaultColor: "#67C496",
      remainingColor: "#2A3931"
    }
  }
};

export const cyberAntdTheme: ThemeConfig = {
  algorithm: antTheme.darkAlgorithm,
  token: {
    colorPrimary: "#9d4edd",
    colorSuccess: "#72efdd",
    colorWarning: "#ffd60a",
    colorError: "#ff006e",
    colorInfo: "#9d4edd",
    colorTextBase: "#c8b6ff",
    colorBgBase: "#1e1e2e",
    colorPrimaryBg: "#312244",
    colorPrimaryBgHover: "#3d2f5a",
    colorPrimaryBorder: "#5a189a",
    colorPrimaryBorderHover: "#7b2cbf",
    colorPrimaryHover: "#7b2cbf",
    colorPrimaryActive: "#5a189a",
    colorPrimaryText: "#c77dff",
    colorPrimaryTextHover: "#e0aaff",
    colorPrimaryTextActive: "#9d4edd",
    colorText: "rgba(200, 182, 255, 0.9)",
    colorTextSecondary: "rgba(200, 182, 255, 0.7)",
    colorTextTertiary: "rgba(200, 182, 255, 0.5)",
    colorTextQuaternary: "rgba(200, 182, 255, 0.3)",
    colorTextDisabled: "rgba(200, 182, 255, 0.3)",
    colorTextPlaceholder: "rgba(200, 182, 255, 0.45)",
    colorBgContainer: "#1e1e2e",
    colorBgElevated: "#2a2a3a",
    colorBgLayout: "#181825",
    colorBgMask: "rgba(29, 30, 46, 0.7)",
    colorBorder: "#3d2f5a",
    colorBorderSecondary: "#312244",
    borderRadius: 12,
    borderRadiusXS: 4,
    borderRadiusSM: 8,
    borderRadiusLG: 16,
    padding: 16,
    paddingSM: 12,
    paddingLG: 24,
    margin: 16,
    marginSM: 12,
    marginLG: 24,
    boxShadow: "none",
    boxShadowSecondary: "none"
  },
  components: {
    ...sharedComponents,
    Button: {
      ...sharedComponents?.Button,
      defaultBg: "#1e1e2e",
      defaultColor: "rgba(200, 182, 255, 0.9)",
      defaultBorderColor: "#3d2f5a",
      defaultHoverBg: "#2a2a3a",
      defaultHoverColor: "#e0aaff",
      defaultHoverBorderColor: "#7b2cbf",
      defaultActiveBg: "#1e1e2e",
      defaultActiveColor: "#9d4edd",
      defaultActiveBorderColor: "#5a189a"
    },
    Card: {
      ...sharedComponents?.Card,
      headerBg: "#1e1e2e",
      extraColor: "rgba(200, 182, 255, 0.7)"
    },
    Input: {
      hoverBorderColor: "#7b2cbf",
      activeBorderColor: "#9d4edd",
      activeShadow: "none",
      hoverBg: "#1e1e2e",
      activeBg: "#1e1e2e"
    },
    Tag: {
      defaultBg: "#312244",
      defaultColor: "#c77dff"
    },
    Timeline: {
      ...sharedComponents?.Timeline,
      dotBg: "#9d4edd",
      tailColor: "#3d2f5a"
    },
    Progress: {
      defaultColor: "#9d4edd",
      remainingColor: "#3d2f5a"
    }
  }
};

export const forgeAntdTheme: ThemeConfig = {
  algorithm: antTheme.darkAlgorithm,
  token: {
    colorPrimary: "#ff6b35",
    colorSuccess: "#00c2a9",
    colorWarning: "#ffa726",
    colorError: "#ff5252",
    colorInfo: "#5e72eb",
    colorTextBase: "#c9d1d9",
    colorBgBase: "#0d1117",
    colorPrimaryBg: "#ff6b3520",
    colorPrimaryBgHover: "#ff6b3530",
    colorPrimaryBorder: "#ff6b3550",
    colorPrimaryBorderHover: "#ff6b3570",
    colorPrimaryHover: "#ff8257",
    colorPrimaryActive: "#e55929",
    colorPrimaryText: "#ff6b35",
    colorPrimaryTextHover: "#ff8257",
    colorPrimaryTextActive: "#e55929",
    colorInfoBg: "#5e72eb20",
    colorInfoBgHover: "#5e72eb30",
    colorInfoBorder: "#5e72eb50",
    colorInfoBorderHover: "#5e72eb70",
    colorInfoHover: "#7c8ff0",
    colorInfoActive: "#4c5fd6",
    colorInfoText: "#5e72eb",
    colorInfoTextHover: "#7c8ff0",
    colorInfoTextActive: "#4c5fd6",
    colorText: "rgba(201, 209, 217, 0.88)",
    colorTextSecondary: "rgba(201, 209, 217, 0.65)",
    colorTextTertiary: "rgba(201, 209, 217, 0.45)",
    colorTextQuaternary: "rgba(201, 209, 217, 0.25)",
    colorTextDisabled: "rgba(201, 209, 217, 0.25)",
    colorTextPlaceholder: "rgba(201, 209, 217, 0.42)",
    colorBgContainer: "#161b22",
    colorBgElevated: "#21262d",
    colorBgLayout: "#0d1117",
    colorBgSpotlight: "rgba(201, 209, 217, 0.85)",
    colorBgMask: "rgba(0, 0, 0, 0.6)",
    colorBorder: "#30363d",
    colorBorderSecondary: "#21262d",
    borderRadius: 6,
    borderRadiusXS: 2,
    borderRadiusSM: 4,
    borderRadiusLG: 8,
    padding: 16,
    paddingSM: 12,
    paddingLG: 20,
    margin: 16,
    marginSM: 12,
    marginLG: 20,
    boxShadow: "0 2px 8px 0 rgba(0, 0, 0, 0.4)",
    boxShadowSecondary: "0 4px 12px 0 rgba(0, 0, 0, 0.5)"
  },
  components: {
    ...sharedComponents,
    Button: {
      ...sharedComponents?.Button,
      defaultBg: "#161b22",
      defaultColor: "rgba(201, 209, 217, 0.88)",
      defaultBorderColor: "#30363d",
      defaultHoverBg: "#21262d",
      defaultHoverColor: "#ff8257",
      defaultHoverBorderColor: "#ff6b3570",
      defaultActiveBg: "#161b22",
      defaultActiveColor: "#e55929",
      defaultActiveBorderColor: "#e55929"
    },
    Card: {
      ...sharedComponents?.Card,
      headerBg: "#161b22",
      extraColor: "rgba(201, 209, 217, 0.65)"
    },
    Input: {
      hoverBorderColor: "#ff6b3570",
      activeBorderColor: "#ff6b35",
      activeShadow: "0 0 0 1px rgba(255, 107, 53, 0.24)",
      hoverBg: "#0d1117",
      activeBg: "#0d1117"
    },
    Tag: {
      defaultBg: "#ff6b3520",
      defaultColor: "#ff6b35"
    },
    Timeline: {
      ...sharedComponents?.Timeline,
      dotBg: "#ff6b35",
      tailColor: "#30363d"
    },
    Progress: {
      defaultColor: "#ff6b35",
      remainingColor: "#30363d"
    }
  }
};

export const forgeLightAntdTheme: ThemeConfig = {
  algorithm: antTheme.defaultAlgorithm,
  token: {
    colorPrimary: "#ff6b35",
    colorSuccess: "#0f9d85",
    colorWarning: "#d97706",
    colorError: "#dc2626",
    colorInfo: "#4f6df5",
    colorTextBase: "#332821",
    colorBgBase: "#fff8f3",
    colorPrimaryBg: "#fff0e8",
    colorPrimaryBgHover: "#ffe1d4",
    colorPrimaryBorder: "#ffc0a5",
    colorPrimaryBorderHover: "#ff946b",
    colorPrimaryHover: "#f97341",
    colorPrimaryActive: "#e55b2a",
    colorPrimaryText: "#d95a2c",
    colorPrimaryTextHover: "#f97341",
    colorPrimaryTextActive: "#b94820",
    colorSuccessBg: "#e7f7f3",
    colorSuccessBgHover: "#ccefe7",
    colorSuccessBorder: "#93d8c8",
    colorSuccessBorderHover: "#0f9d85",
    colorSuccessHover: "#14b39a",
    colorSuccessActive: "#0b7c69",
    colorSuccessText: "#0f9d85",
    colorSuccessTextHover: "#14b39a",
    colorSuccessTextActive: "#0b7c69",
    colorWarningBg: "#fff4db",
    colorWarningBgHover: "#ffe7b0",
    colorWarningBorder: "#f6c978",
    colorWarningBorderHover: "#d97706",
    colorWarningHover: "#ea8b17",
    colorWarningActive: "#b95f05",
    colorWarningText: "#b96b00",
    colorWarningTextHover: "#d97706",
    colorWarningTextActive: "#9a5600",
    colorErrorBg: "#fff0ef",
    colorErrorBgHover: "#ffd9d6",
    colorErrorBorder: "#ffb0aa",
    colorErrorBorderHover: "#dc2626",
    colorErrorHover: "#ef4444",
    colorErrorActive: "#b91c1c",
    colorErrorText: "#dc2626",
    colorErrorTextHover: "#ef4444",
    colorErrorTextActive: "#b91c1c",
    colorInfoBg: "#eef1ff",
    colorInfoBgHover: "#dfe4ff",
    colorInfoBorder: "#c0cbff",
    colorInfoBorderHover: "#4f6df5",
    colorInfoHover: "#6f86ff",
    colorInfoActive: "#3e57d0",
    colorInfoText: "#4f6df5",
    colorInfoTextHover: "#6f86ff",
    colorInfoTextActive: "#3e57d0",
    colorText: "rgba(51, 40, 33, 0.92)",
    colorTextSecondary: "rgba(51, 40, 33, 0.68)",
    colorTextTertiary: "rgba(51, 40, 33, 0.5)",
    colorTextQuaternary: "rgba(51, 40, 33, 0.34)",
    colorTextDisabled: "rgba(51, 40, 33, 0.34)",
    colorTextPlaceholder: "rgba(51, 40, 33, 0.46)",
    colorBgContainer: "#ffffff",
    colorBgElevated: "#fffaf6",
    colorBgLayout: "#fff3eb",
    colorBgSpotlight: "rgba(51, 40, 33, 0.86)",
    colorBgMask: "rgba(91, 60, 45, 0.22)",
    colorBorder: "#e7d8cd",
    colorBorderSecondary: "#f2e8e1",
    borderRadius: 6,
    borderRadiusXS: 2,
    borderRadiusSM: 4,
    borderRadiusLG: 8,
    padding: 16,
    paddingSM: 12,
    paddingLG: 20,
    margin: 16,
    marginSM: 12,
    marginLG: 20,
    boxShadow: "0 2px 8px 0 rgba(120, 73, 45, 0.10)",
    boxShadowSecondary: "0 8px 24px 0 rgba(120, 73, 45, 0.16)"
  },
  components: {
    ...sharedComponents,
    Button: {
      ...sharedComponents?.Button,
      defaultBg: "#ffffff",
      defaultColor: "rgba(51, 40, 33, 0.92)",
      defaultBorderColor: "#e7d8cd",
      defaultHoverBg: "#fff8f3",
      defaultHoverColor: "#f97341",
      defaultHoverBorderColor: "#ff946b",
      defaultActiveBg: "#ffffff",
      defaultActiveColor: "#d95a2c",
      defaultActiveBorderColor: "#d95a2c"
    },
    Card: {
      ...sharedComponents?.Card,
      headerBg: "#ffffff",
      extraColor: "rgba(51, 40, 33, 0.68)"
    },
    Input: {
      hoverBorderColor: "#ff946b",
      activeBorderColor: "#ff6b35",
      activeShadow: "0 0 0 1px rgba(255, 107, 53, 0.22)",
      hoverBg: "#ffffff",
      activeBg: "#ffffff"
    },
    Tag: {
      defaultBg: "#fff0e8",
      defaultColor: "#d95a2c"
    },
    Timeline: {
      ...sharedComponents?.Timeline,
      dotBg: "#ff6b35",
      tailColor: "#e7d8cd"
    },
    Progress: {
      defaultColor: "#ff6b35",
      remainingColor: "#f2e8e1"
    }
  }
};

export const githubAntdTheme: ThemeConfig = {
  algorithm: antTheme.darkAlgorithm,
  token: {
    colorPrimary: "#1f6feb",
    colorSuccess: "#238636",
    colorWarning: "#f85149",
    colorError: "#f85149",
    colorInfo: "#1f6feb",
    colorTextBase: "#c9d1d9",
    colorBgBase: "#0d1117",
    colorPrimaryBg: "#21262d",
    colorPrimaryBgHover: "#30363d",
    colorPrimaryBorder: "#1f6feb",
    colorPrimaryBorderHover: "#388bfd",
    colorPrimaryHover: "#388bfd",
    colorPrimaryActive: "#1f6feb",
    colorPrimaryText: "#58a6ff",
    colorPrimaryTextHover: "#79c0ff",
    colorPrimaryTextActive: "#a5d6ff",
    colorSuccessBg: "#21262d",
    colorSuccessBgHover: "#30363d",
    colorSuccessBorder: "#238636",
    colorSuccessBorderHover: "#2ea043",
    colorSuccessHover: "#2ea043",
    colorSuccessActive: "#238636",
    colorSuccessText: "#3fb950",
    colorSuccessTextHover: "#56d364",
    colorSuccessTextActive: "#7ee787",
    colorWarningBg: "#21262d",
    colorWarningBgHover: "#30363d",
    colorWarningBorder: "#f85149",
    colorWarningBorderHover: "#ff7b72",
    colorWarningHover: "#ff7b72",
    colorWarningActive: "#f85149",
    colorWarningText: "#ff7b72",
    colorWarningTextHover: "#ffa198",
    colorWarningTextActive: "#ffc1ba",
    colorErrorBg: "#21262d",
    colorErrorBgHover: "#30363d",
    colorErrorBorder: "#f85149",
    colorErrorBorderHover: "#ff7b72",
    colorErrorHover: "#ff7b72",
    colorErrorActive: "#f85149",
    colorErrorText: "#ff7b72",
    colorErrorTextHover: "#ffa198",
    colorErrorTextActive: "#ffc1ba",
    colorInfoBg: "#21262d",
    colorInfoBgHover: "#30363d",
    colorInfoBorder: "#1f6feb",
    colorInfoBorderHover: "#388bfd",
    colorInfoHover: "#388bfd",
    colorInfoActive: "#1f6feb",
    colorInfoText: "#58a6ff",
    colorInfoTextHover: "#79c0ff",
    colorInfoTextActive: "#a5d6ff",
    colorText: "#c9d1d9",
    colorTextSecondary: "#8b949e",
    colorTextTertiary: "#6e7681",
    colorTextQuaternary: "#484f58",
    colorTextDisabled: "#484f58",
    colorTextPlaceholder: "#6e7681",
    colorBgContainer: "#161b22",
    colorBgElevated: "#21262d",
    colorBgLayout: "#0d1117",
    colorBgSpotlight: "#21262d",
    colorBgMask: "rgba(13, 17, 23, 0.6)",
    colorBorder: "#30363d",
    colorBorderSecondary: "#21262d",
    borderRadius: 6,
    borderRadiusXS: 2,
    borderRadiusSM: 4,
    borderRadiusLG: 8,
    padding: 16,
    paddingSM: 12,
    paddingLG: 24,
    margin: 16,
    marginSM: 12,
    marginLG: 24,
    boxShadow: "0 0 0 1px #30363d",
    boxShadowSecondary: "0 8px 24px rgba(1, 4, 9, 0.48)"
  },
  components: {
    ...sharedComponents,
    Button: {
      ...sharedComponents?.Button,
      defaultBg: "#161b22",
      defaultColor: "#c9d1d9",
      defaultBorderColor: "#30363d",
      defaultHoverBg: "#21262d",
      defaultHoverColor: "#79c0ff",
      defaultHoverBorderColor: "#388bfd",
      defaultActiveBg: "#161b22",
      defaultActiveColor: "#58a6ff",
      defaultActiveBorderColor: "#1f6feb"
    },
    Card: {
      ...sharedComponents?.Card,
      headerBg: "#161b22",
      extraColor: "#8b949e"
    },
    Input: {
      hoverBorderColor: "#388bfd",
      activeBorderColor: "#1f6feb",
      activeShadow: "0 0 0 1px rgba(31, 111, 235, 0.28)",
      hoverBg: "#0d1117",
      activeBg: "#0d1117"
    },
    Tag: {
      defaultBg: "#21262d",
      defaultColor: "#58a6ff"
    },
    Timeline: {
      ...sharedComponents?.Timeline,
      dotBg: "#1f6feb",
      tailColor: "#30363d"
    },
    Progress: {
      defaultColor: "#1f6feb",
      remainingColor: "#30363d"
    }
  }
};

export const githubLightAntdTheme: ThemeConfig = {
  algorithm: antTheme.defaultAlgorithm,
  token: {
    colorPrimary: "#0969da",
    colorSuccess: "#1a7f37",
    colorWarning: "#bf8700",
    colorError: "#cf222e",
    colorInfo: "#0969da",
    colorTextBase: "#1f2328",
    colorBgBase: "#ffffff",
    colorPrimaryBg: "#ddf4ff",
    colorPrimaryBgHover: "#b6e3ff",
    colorPrimaryBorder: "#80ccff",
    colorPrimaryBorderHover: "#54aeff",
    colorPrimaryHover: "#218bff",
    colorPrimaryActive: "#0969da",
    colorPrimaryText: "#0969da",
    colorPrimaryTextHover: "#218bff",
    colorPrimaryTextActive: "#0550ae",
    colorSuccessBg: "#dafbe1",
    colorSuccessBgHover: "#aceebb",
    colorSuccessBorder: "#4ac26b",
    colorSuccessBorderHover: "#2da44e",
    colorSuccessHover: "#2da44e",
    colorSuccessActive: "#1a7f37",
    colorSuccessText: "#1a7f37",
    colorSuccessTextHover: "#2da44e",
    colorSuccessTextActive: "#116329",
    colorWarningBg: "#fff8c5",
    colorWarningBgHover: "#fae17d",
    colorWarningBorder: "#d4a72c",
    colorWarningBorderHover: "#bf8700",
    colorWarningHover: "#9a6700",
    colorWarningActive: "#7d4e00",
    colorWarningText: "#9a6700",
    colorWarningTextHover: "#bf8700",
    colorWarningTextActive: "#7d4e00",
    colorErrorBg: "#ffebe9",
    colorErrorBgHover: "#ffcecb",
    colorErrorBorder: "#ff8182",
    colorErrorBorderHover: "#cf222e",
    colorErrorHover: "#cf222e",
    colorErrorActive: "#a40e26",
    colorErrorText: "#cf222e",
    colorErrorTextHover: "#a40e26",
    colorErrorTextActive: "#82071e",
    colorInfoBg: "#ddf4ff",
    colorInfoBgHover: "#b6e3ff",
    colorInfoBorder: "#80ccff",
    colorInfoBorderHover: "#54aeff",
    colorInfoHover: "#218bff",
    colorInfoActive: "#0969da",
    colorInfoText: "#0969da",
    colorInfoTextHover: "#218bff",
    colorInfoTextActive: "#0550ae",
    colorText: "#1f2328",
    colorTextSecondary: "#57606a",
    colorTextTertiary: "#6e7781",
    colorTextQuaternary: "#8c959f",
    colorTextDisabled: "#8c959f",
    colorTextPlaceholder: "#6e7781",
    colorBgContainer: "#ffffff",
    colorBgElevated: "#ffffff",
    colorBgLayout: "#f6f8fa",
    colorBgSpotlight: "rgba(31, 35, 40, 0.85)",
    colorBgMask: "rgba(140, 149, 159, 0.2)",
    colorBorder: "#d0d7de",
    colorBorderSecondary: "#eaeef2",
    borderRadius: 6,
    borderRadiusXS: 2,
    borderRadiusSM: 4,
    borderRadiusLG: 8,
    padding: 16,
    paddingSM: 12,
    paddingLG: 24,
    margin: 16,
    marginSM: 12,
    marginLG: 24,
    boxShadow: "0 1px 3px rgba(31, 35, 40, 0.12)",
    boxShadowSecondary: "0 8px 24px rgba(140, 149, 159, 0.2)"
  },
  components: {
    ...sharedComponents,
    Button: {
      ...sharedComponents?.Button,
      defaultBg: "#ffffff",
      defaultColor: "#1f2328",
      defaultBorderColor: "#d0d7de",
      defaultHoverBg: "#f6f8fa",
      defaultHoverColor: "#0969da",
      defaultHoverBorderColor: "#0969da",
      defaultActiveBg: "#ffffff",
      defaultActiveColor: "#0550ae",
      defaultActiveBorderColor: "#0550ae"
    },
    Card: {
      ...sharedComponents?.Card,
      headerBg: "#ffffff",
      extraColor: "#57606a"
    },
    Input: {
      hoverBorderColor: "#0969da",
      activeBorderColor: "#0969da",
      activeShadow: "0 0 0 1px rgba(9, 105, 218, 0.3)",
      hoverBg: "#ffffff",
      activeBg: "#ffffff"
    },
    Tag: {
      defaultBg: "#ddf4ff",
      defaultColor: "#0969da"
    },
    Timeline: {
      ...sharedComponents?.Timeline,
      dotBg: "#0969da",
      tailColor: "#d0d7de"
    },
    Progress: {
      defaultColor: "#0969da",
      remainingColor: "#eaeef2"
    }
  }
};

export const nordAntdTheme: ThemeConfig = {
  algorithm: antTheme.darkAlgorithm,
  token: {
    colorPrimary: "#88c0d0",
    colorSuccess: "#a3be8c",
    colorWarning: "#ebcb8b",
    colorError: "#bf616a",
    colorInfo: "#81a1c1",
    colorTextBase: "#eceff4",
    colorBgBase: "#2e3440",
    colorPrimaryBg: "#3b4252",
    colorPrimaryBgHover: "#434c5e",
    colorPrimaryBorder: "#5e81ac",
    colorPrimaryBorderHover: "#88c0d0",
    colorPrimaryHover: "#8fbcbb",
    colorPrimaryActive: "#5e81ac",
    colorPrimaryText: "#88c0d0",
    colorPrimaryTextHover: "#a3d5e0",
    colorPrimaryTextActive: "#5e81ac",
    colorSuccessBg: "#38423b",
    colorSuccessBgHover: "#425046",
    colorSuccessBorder: "#6d8a63",
    colorSuccessBorderHover: "#a3be8c",
    colorSuccessHover: "#b4cb9c",
    colorSuccessActive: "#7d9d72",
    colorSuccessText: "#a3be8c",
    colorSuccessTextHover: "#bdd3a9",
    colorSuccessTextActive: "#7d9d72",
    colorWarningBg: "#463f34",
    colorWarningBgHover: "#524a3d",
    colorWarningBorder: "#b79c67",
    colorWarningBorderHover: "#ebcb8b",
    colorWarningHover: "#f0d49f",
    colorWarningActive: "#c6aa72",
    colorWarningText: "#ebcb8b",
    colorWarningTextHover: "#f1d6a2",
    colorWarningTextActive: "#c6aa72",
    colorErrorBg: "#46363b",
    colorErrorBgHover: "#544046",
    colorErrorBorder: "#9f5e67",
    colorErrorBorderHover: "#bf616a",
    colorErrorHover: "#cf7b84",
    colorErrorActive: "#a14c55",
    colorErrorText: "#d08770",
    colorErrorTextHover: "#dea08d",
    colorErrorTextActive: "#bf616a",
    colorInfoBg: "#34414e",
    colorInfoBgHover: "#3b4a58",
    colorInfoBorder: "#5e81ac",
    colorInfoBorderHover: "#81a1c1",
    colorInfoHover: "#96b4d0",
    colorInfoActive: "#5e81ac",
    colorInfoText: "#81a1c1",
    colorInfoTextHover: "#9fb9d4",
    colorInfoTextActive: "#5e81ac",
    colorText: "#e5e9f0",
    colorTextSecondary: "#c2cad6",
    colorTextTertiary: "#aab4c1",
    colorTextQuaternary: "#8691a1",
    colorTextDisabled: "#8691a1",
    colorTextPlaceholder: "#9ea8b6",
    colorBgContainer: "#3b4252",
    colorBgElevated: "#434c5e",
    colorBgLayout: "#2b303b",
    colorBgSpotlight: "rgba(236, 239, 244, 0.9)",
    colorBgMask: "rgba(33, 38, 48, 0.65)",
    colorBorder: "#4c566a",
    colorBorderSecondary: "#434c5e",
    borderRadius: 10,
    borderRadiusXS: 2,
    borderRadiusSM: 6,
    borderRadiusLG: 12,
    padding: 16,
    paddingSM: 12,
    paddingLG: 24,
    margin: 16,
    marginSM: 12,
    marginLG: 24,
    boxShadow: "0 1px 0 rgba(236, 239, 244, 0.04)",
    boxShadowSecondary: "0 18px 40px rgba(28, 32, 40, 0.38)"
  },
  components: {
    ...sharedComponents,
    Button: {
      ...sharedComponents?.Button,
      defaultBg: "#3b4252",
      defaultColor: "#e5e9f0",
      defaultBorderColor: "#4c566a",
      defaultHoverBg: "#434c5e",
      defaultHoverColor: "#88c0d0",
      defaultHoverBorderColor: "#88c0d0",
      defaultActiveBg: "#3b4252",
      defaultActiveColor: "#81a1c1",
      defaultActiveBorderColor: "#5e81ac"
    },
    Card: {
      ...sharedComponents?.Card,
      headerBg: "#3b4252",
      extraColor: "#c2cad6"
    },
    Input: {
      hoverBorderColor: "#88c0d0",
      activeBorderColor: "#81a1c1",
      activeShadow: "0 0 0 1px rgba(136, 192, 208, 0.28)",
      hoverBg: "#2e3440",
      activeBg: "#2e3440"
    },
    Tag: {
      defaultBg: "#34414e",
      defaultColor: "#88c0d0"
    },
    Timeline: {
      ...sharedComponents?.Timeline,
      dotBg: "#88c0d0",
      tailColor: "#4c566a"
    },
    Progress: {
      defaultColor: "#88c0d0",
      remainingColor: "#4c566a"
    }
  }
};

export const solarizedLightAntdTheme: ThemeConfig = {
  algorithm: antTheme.defaultAlgorithm,
  token: {
    colorPrimary: "#268bd2",
    colorSuccess: "#859900",
    colorWarning: "#b58900",
    colorError: "#dc322f",
    colorInfo: "#2aa198",
    colorTextBase: "#586e75",
    colorBgBase: "#fdf6e3",
    colorPrimaryBg: "#eef6f7",
    colorPrimaryBgHover: "#dbeff4",
    colorPrimaryBorder: "#9fc5d5",
    colorPrimaryBorderHover: "#268bd2",
    colorPrimaryHover: "#1f7cc1",
    colorPrimaryActive: "#1869a5",
    colorPrimaryText: "#268bd2",
    colorPrimaryTextHover: "#1f7cc1",
    colorPrimaryTextActive: "#1869a5",
    colorSuccessBg: "#f2f6d8",
    colorSuccessBgHover: "#e8efc0",
    colorSuccessBorder: "#b6c26f",
    colorSuccessBorderHover: "#859900",
    colorSuccessHover: "#738600",
    colorSuccessActive: "#637400",
    colorSuccessText: "#859900",
    colorSuccessTextHover: "#738600",
    colorSuccessTextActive: "#637400",
    colorWarningBg: "#faf1d2",
    colorWarningBgHover: "#f2e4b4",
    colorWarningBorder: "#d0b25b",
    colorWarningBorderHover: "#b58900",
    colorWarningHover: "#9b7600",
    colorWarningActive: "#816100",
    colorWarningText: "#b58900",
    colorWarningTextHover: "#9b7600",
    colorWarningTextActive: "#816100",
    colorErrorBg: "#fce6df",
    colorErrorBgHover: "#f7d4ca",
    colorErrorBorder: "#e78f87",
    colorErrorBorderHover: "#dc322f",
    colorErrorHover: "#c72c2a",
    colorErrorActive: "#aa2422",
    colorErrorText: "#dc322f",
    colorErrorTextHover: "#c72c2a",
    colorErrorTextActive: "#aa2422",
    colorInfoBg: "#e3f4f1",
    colorInfoBgHover: "#d1eeea",
    colorInfoBorder: "#7ec4bd",
    colorInfoBorderHover: "#2aa198",
    colorInfoHover: "#228a82",
    colorInfoActive: "#1c746d",
    colorInfoText: "#2aa198",
    colorInfoTextHover: "#228a82",
    colorInfoTextActive: "#1c746d",
    colorText: "#586e75",
    colorTextSecondary: "#6b7f86",
    colorTextTertiary: "#839496",
    colorTextQuaternary: "#93a1a1",
    colorTextDisabled: "#93a1a1",
    colorTextPlaceholder: "#839496",
    colorBgContainer: "#fdf6e3",
    colorBgElevated: "#fff9e9",
    colorBgLayout: "#f4edd8",
    colorBgSpotlight: "rgba(88, 110, 117, 0.84)",
    colorBgMask: "rgba(147, 161, 161, 0.24)",
    colorBorder: "#d7ceb5",
    colorBorderSecondary: "#e8dec4",
    borderRadius: 8,
    borderRadiusXS: 2,
    borderRadiusSM: 4,
    borderRadiusLG: 10,
    padding: 16,
    paddingSM: 12,
    paddingLG: 24,
    margin: 16,
    marginSM: 12,
    marginLG: 24,
    boxShadow: "0 1px 2px rgba(88, 110, 117, 0.12)",
    boxShadowSecondary: "0 18px 40px rgba(131, 148, 150, 0.16)"
  },
  components: {
    ...sharedComponents,
    Button: {
      ...sharedComponents?.Button,
      defaultBg: "#fff9e9",
      defaultColor: "#586e75",
      defaultBorderColor: "#d7ceb5",
      defaultHoverBg: "#f4edd8",
      defaultHoverColor: "#268bd2",
      defaultHoverBorderColor: "#268bd2",
      defaultActiveBg: "#fff9e9",
      defaultActiveColor: "#1869a5",
      defaultActiveBorderColor: "#1869a5"
    },
    Card: {
      ...sharedComponents?.Card,
      headerBg: "#fff9e9",
      extraColor: "#6b7f86"
    },
    Input: {
      hoverBorderColor: "#268bd2",
      activeBorderColor: "#268bd2",
      activeShadow: "0 0 0 1px rgba(38, 139, 210, 0.22)",
      hoverBg: "#fffdf6",
      activeBg: "#fffdf6"
    },
    Tag: {
      defaultBg: "#eef6f7",
      defaultColor: "#268bd2"
    },
    Timeline: {
      ...sharedComponents?.Timeline,
      dotBg: "#268bd2",
      tailColor: "#d7ceb5"
    },
    Progress: {
      defaultColor: "#268bd2",
      remainingColor: "#e8dec4"
    }
  }
};

export const gruvboxDarkAntdTheme: ThemeConfig = {
  algorithm: antTheme.darkAlgorithm,
  token: {
    colorPrimary: "#d79921",
    colorSuccess: "#98971a",
    colorWarning: "#fabd2f",
    colorError: "#fb4934",
    colorInfo: "#83a598",
    colorTextBase: "#ebdbb2",
    colorBgBase: "#282828",
    colorPrimaryBg: "#3c3836",
    colorPrimaryBgHover: "#504945",
    colorPrimaryBorder: "#7c6f64",
    colorPrimaryBorderHover: "#d79921",
    colorPrimaryHover: "#e0a83a",
    colorPrimaryActive: "#b57614",
    colorPrimaryText: "#d79921",
    colorPrimaryTextHover: "#e6b450",
    colorPrimaryTextActive: "#b57614",
    colorSuccessBg: "#30361d",
    colorSuccessBgHover: "#394223",
    colorSuccessBorder: "#656d31",
    colorSuccessBorderHover: "#98971a",
    colorSuccessHover: "#b0b02b",
    colorSuccessActive: "#7f7f16",
    colorSuccessText: "#b8bb26",
    colorSuccessTextHover: "#cccf39",
    colorSuccessTextActive: "#98971a",
    colorWarningBg: "#41351c",
    colorWarningBgHover: "#4d3f22",
    colorWarningBorder: "#a06d24",
    colorWarningBorderHover: "#fabd2f",
    colorWarningHover: "#ffd166",
    colorWarningActive: "#cc8f1f",
    colorWarningText: "#fabd2f",
    colorWarningTextHover: "#ffd166",
    colorWarningTextActive: "#cc8f1f",
    colorErrorBg: "#442726",
    colorErrorBgHover: "#55302d",
    colorErrorBorder: "#9d4a3f",
    colorErrorBorderHover: "#fb4934",
    colorErrorHover: "#ff6b57",
    colorErrorActive: "#cc3a29",
    colorErrorText: "#fb4934",
    colorErrorTextHover: "#ff7d6d",
    colorErrorTextActive: "#cc3a29",
    colorInfoBg: "#293634",
    colorInfoBgHover: "#304240",
    colorInfoBorder: "#5f7f77",
    colorInfoBorderHover: "#83a598",
    colorInfoHover: "#9eb9af",
    colorInfoActive: "#66857b",
    colorInfoText: "#83a598",
    colorInfoTextHover: "#a4c0b6",
    colorInfoTextActive: "#66857b",
    colorText: "#ebdbb2",
    colorTextSecondary: "#d5c4a1",
    colorTextTertiary: "#bdae93",
    colorTextQuaternary: "#928374",
    colorTextDisabled: "#928374",
    colorTextPlaceholder: "#a89984",
    colorBgContainer: "#32302f",
    colorBgElevated: "#3c3836",
    colorBgLayout: "#1d2021",
    colorBgSpotlight: "rgba(235, 219, 178, 0.88)",
    colorBgMask: "rgba(0, 0, 0, 0.58)",
    colorBorder: "#504945",
    colorBorderSecondary: "#3c3836",
    borderRadius: 8,
    borderRadiusXS: 2,
    borderRadiusSM: 4,
    borderRadiusLG: 10,
    padding: 16,
    paddingSM: 12,
    paddingLG: 24,
    margin: 16,
    marginSM: 12,
    marginLG: 24,
    boxShadow: "0 1px 0 rgba(235, 219, 178, 0.05)",
    boxShadowSecondary: "0 16px 36px rgba(0, 0, 0, 0.38)"
  },
  components: {
    ...sharedComponents,
    Button: {
      ...sharedComponents?.Button,
      defaultBg: "#32302f",
      defaultColor: "#ebdbb2",
      defaultBorderColor: "#504945",
      defaultHoverBg: "#3c3836",
      defaultHoverColor: "#fabd2f",
      defaultHoverBorderColor: "#d79921",
      defaultActiveBg: "#32302f",
      defaultActiveColor: "#d79921",
      defaultActiveBorderColor: "#b57614"
    },
    Card: {
      ...sharedComponents?.Card,
      headerBg: "#32302f",
      extraColor: "#bdae93"
    },
    Input: {
      hoverBorderColor: "#d79921",
      activeBorderColor: "#d79921",
      activeShadow: "0 0 0 1px rgba(215, 153, 33, 0.24)",
      hoverBg: "#282828",
      activeBg: "#282828"
    },
    Tag: {
      defaultBg: "#41351c",
      defaultColor: "#fabd2f"
    },
    Timeline: {
      ...sharedComponents?.Timeline,
      dotBg: "#d79921",
      tailColor: "#504945"
    },
    Progress: {
      defaultColor: "#d79921",
      remainingColor: "#504945"
    }
  }
};

export const highContrastAntdTheme: ThemeConfig = {
  algorithm: antTheme.darkAlgorithm,
  token: {
    colorPrimary: "#4da3ff",
    colorSuccess: "#00d26a",
    colorWarning: "#ffd400",
    colorError: "#ff5c5c",
    colorInfo: "#4da3ff",
    colorTextBase: "#ffffff",
    colorBgBase: "#000000",
    colorPrimaryBg: "#00152a",
    colorPrimaryBgHover: "#002145",
    colorPrimaryBorder: "#4da3ff",
    colorPrimaryBorderHover: "#7abbff",
    colorPrimaryHover: "#7abbff",
    colorPrimaryActive: "#2c8cff",
    colorPrimaryText: "#7abbff",
    colorPrimaryTextHover: "#a6d3ff",
    colorPrimaryTextActive: "#4da3ff",
    colorSuccessBg: "#001d0d",
    colorSuccessBgHover: "#003018",
    colorSuccessBorder: "#00d26a",
    colorSuccessBorderHover: "#43f090",
    colorSuccessHover: "#43f090",
    colorSuccessActive: "#00b85d",
    colorSuccessText: "#43f090",
    colorSuccessTextHover: "#7df9b5",
    colorSuccessTextActive: "#00d26a",
    colorWarningBg: "#241f00",
    colorWarningBgHover: "#383000",
    colorWarningBorder: "#ffd400",
    colorWarningBorderHover: "#ffe14d",
    colorWarningHover: "#ffe14d",
    colorWarningActive: "#e0b800",
    colorWarningText: "#ffe14d",
    colorWarningTextHover: "#ffeb80",
    colorWarningTextActive: "#ffd400",
    colorErrorBg: "#2a0000",
    colorErrorBgHover: "#420000",
    colorErrorBorder: "#ff5c5c",
    colorErrorBorderHover: "#ff8a8a",
    colorErrorHover: "#ff8a8a",
    colorErrorActive: "#e04747",
    colorErrorText: "#ff8a8a",
    colorErrorTextHover: "#ffb0b0",
    colorErrorTextActive: "#ff5c5c",
    colorInfoBg: "#00152a",
    colorInfoBgHover: "#002145",
    colorInfoBorder: "#4da3ff",
    colorInfoBorderHover: "#7abbff",
    colorInfoHover: "#7abbff",
    colorInfoActive: "#2c8cff",
    colorInfoText: "#7abbff",
    colorInfoTextHover: "#a6d3ff",
    colorInfoTextActive: "#4da3ff",
    colorText: "#ffffff",
    colorTextSecondary: "#d9d9d9",
    colorTextTertiary: "#bfbfbf",
    colorTextQuaternary: "#8c8c8c",
    colorTextDisabled: "#8c8c8c",
    colorTextPlaceholder: "#bfbfbf",
    colorBgContainer: "#0f0f0f",
    colorBgElevated: "#171717",
    colorBgLayout: "#000000",
    colorBgSpotlight: "rgba(255, 255, 255, 0.96)",
    colorBgMask: "rgba(0, 0, 0, 0.82)",
    colorBorder: "#8c8c8c",
    colorBorderSecondary: "#4d4d4d",
    borderRadius: 4,
    borderRadiusXS: 2,
    borderRadiusSM: 4,
    borderRadiusLG: 6,
    padding: 16,
    paddingSM: 12,
    paddingLG: 24,
    margin: 16,
    marginSM: 12,
    marginLG: 24,
    boxShadow: "none",
    boxShadowSecondary: "none"
  },
  components: {
    ...sharedComponents,
    Button: {
      ...sharedComponents?.Button,
      defaultBg: "#0f0f0f",
      defaultColor: "#ffffff",
      defaultBorderColor: "#8c8c8c",
      defaultHoverBg: "#171717",
      defaultHoverColor: "#a6d3ff",
      defaultHoverBorderColor: "#7abbff",
      defaultActiveBg: "#0f0f0f",
      defaultActiveColor: "#7abbff",
      defaultActiveBorderColor: "#4da3ff"
    },
    Card: {
      ...sharedComponents?.Card,
      headerBg: "#0f0f0f",
      extraColor: "#d9d9d9"
    },
    Input: {
      hoverBorderColor: "#7abbff",
      activeBorderColor: "#4da3ff",
      activeShadow: "0 0 0 2px rgba(77, 163, 255, 0.36)",
      hoverBg: "#000000",
      activeBg: "#000000"
    },
    Tag: {
      defaultBg: "#00152a",
      defaultColor: "#a6d3ff"
    },
    Timeline: {
      ...sharedComponents?.Timeline,
      dotBg: "#4da3ff",
      tailColor: "#8c8c8c"
    },
    Progress: {
      defaultColor: "#4da3ff",
      remainingColor: "#4d4d4d"
    }
  }
};

export const tokyoNightAntdTheme: ThemeConfig = {
  algorithm: antTheme.darkAlgorithm,
  token: {
    colorPrimary: "#7aa2f7",
    colorSuccess: "#9ece6a",
    colorWarning: "#e0af68",
    colorError: "#f7768e",
    colorInfo: "#7dcfff",
    colorTextBase: "#c0caf5",
    colorBgBase: "#1a1b26",
    colorPrimaryBg: "#24283b",
    colorPrimaryBgHover: "#2f354f",
    colorPrimaryBorder: "#3b4261",
    colorPrimaryBorderHover: "#7aa2f7",
    colorPrimaryHover: "#93b7ff",
    colorPrimaryActive: "#5f86e8",
    colorPrimaryText: "#7aa2f7",
    colorPrimaryTextHover: "#a3c2ff",
    colorPrimaryTextActive: "#5f86e8",
    colorSuccessBg: "#223126",
    colorSuccessBgHover: "#2b3d2f",
    colorSuccessBorder: "#4f7250",
    colorSuccessBorderHover: "#9ece6a",
    colorSuccessHover: "#b2de7f",
    colorSuccessActive: "#7fad4e",
    colorSuccessText: "#9ece6a",
    colorSuccessTextHover: "#b9e585",
    colorSuccessTextActive: "#7fad4e",
    colorWarningBg: "#352d22",
    colorWarningBgHover: "#43372a",
    colorWarningBorder: "#8d7043",
    colorWarningBorderHover: "#e0af68",
    colorWarningHover: "#ecc082",
    colorWarningActive: "#c2914c",
    colorWarningText: "#e0af68",
    colorWarningTextHover: "#f0ca8f",
    colorWarningTextActive: "#c2914c",
    colorErrorBg: "#3b2532",
    colorErrorBgHover: "#4a2e3e",
    colorErrorBorder: "#8e4c67",
    colorErrorBorderHover: "#f7768e",
    colorErrorHover: "#ff8fa4",
    colorErrorActive: "#d25d74",
    colorErrorText: "#f7768e",
    colorErrorTextHover: "#ff9fb0",
    colorErrorTextActive: "#d25d74",
    colorInfoBg: "#223447",
    colorInfoBgHover: "#2b4056",
    colorInfoBorder: "#4e6b85",
    colorInfoBorderHover: "#7dcfff",
    colorInfoHover: "#98d8ff",
    colorInfoActive: "#60b3e0",
    colorInfoText: "#7dcfff",
    colorInfoTextHover: "#a9e4ff",
    colorInfoTextActive: "#60b3e0",
    colorText: "#c0caf5",
    colorTextSecondary: "#a9b1d6",
    colorTextTertiary: "#787c99",
    colorTextQuaternary: "#565f89",
    colorTextDisabled: "#565f89",
    colorTextPlaceholder: "#787c99",
    colorBgContainer: "#1f2335",
    colorBgElevated: "#24283b",
    colorBgLayout: "#16161e",
    colorBgSpotlight: "rgba(192, 202, 245, 0.9)",
    colorBgMask: "rgba(15, 17, 26, 0.72)",
    colorBorder: "#3b4261",
    colorBorderSecondary: "#2f354f",
    borderRadius: 10,
    borderRadiusXS: 2,
    borderRadiusSM: 6,
    borderRadiusLG: 12,
    padding: 16,
    paddingSM: 12,
    paddingLG: 24,
    margin: 16,
    marginSM: 12,
    marginLG: 24,
    boxShadow: "0 1px 0 rgba(192, 202, 245, 0.04)",
    boxShadowSecondary: "0 20px 44px rgba(12, 14, 24, 0.42)"
  },
  components: {
    ...sharedComponents,
    Button: {
      ...sharedComponents?.Button,
      defaultBg: "#1f2335",
      defaultColor: "#c0caf5",
      defaultBorderColor: "#3b4261",
      defaultHoverBg: "#24283b",
      defaultHoverColor: "#93b7ff",
      defaultHoverBorderColor: "#7aa2f7",
      defaultActiveBg: "#1f2335",
      defaultActiveColor: "#7aa2f7",
      defaultActiveBorderColor: "#5f86e8"
    },
    Card: {
      ...sharedComponents?.Card,
      headerBg: "#1f2335",
      extraColor: "#a9b1d6"
    },
    Input: {
      hoverBorderColor: "#7aa2f7",
      activeBorderColor: "#7aa2f7",
      activeShadow: "0 0 0 1px rgba(122, 162, 247, 0.26)",
      hoverBg: "#1a1b26",
      activeBg: "#1a1b26"
    },
    Tag: {
      defaultBg: "#223447",
      defaultColor: "#7dcfff"
    },
    Timeline: {
      ...sharedComponents?.Timeline,
      dotBg: "#7aa2f7",
      tailColor: "#3b4261"
    },
    Progress: {
      defaultColor: "#7aa2f7",
      remainingColor: "#3b4261"
    }
  }
};

export const solarizedDarkAntdTheme: ThemeConfig = {
  algorithm: antTheme.darkAlgorithm,
  token: {
    colorPrimary: "#268bd2",
    colorSuccess: "#859900",
    colorWarning: "#b58900",
    colorError: "#dc322f",
    colorInfo: "#2aa198",
    colorTextBase: "#93a1a1",
    colorBgBase: "#002b36",
    colorPrimaryBg: "#073642",
    colorPrimaryBgHover: "#0d4655",
    colorPrimaryBorder: "#2d5662",
    colorPrimaryBorderHover: "#268bd2",
    colorPrimaryHover: "#3ea2eb",
    colorPrimaryActive: "#1f73b0",
    colorPrimaryText: "#268bd2",
    colorPrimaryTextHover: "#4ab0f4",
    colorPrimaryTextActive: "#1f73b0",
    colorSuccessBg: "#1b3314",
    colorSuccessBgHover: "#25421a",
    colorSuccessBorder: "#4c611b",
    colorSuccessBorderHover: "#859900",
    colorSuccessHover: "#9aaf14",
    colorSuccessActive: "#6d7d00",
    colorSuccessText: "#859900",
    colorSuccessTextHover: "#9db312",
    colorSuccessTextActive: "#6d7d00",
    colorWarningBg: "#3a2d09",
    colorWarningBgHover: "#4a3a0d",
    colorWarningBorder: "#7d5f12",
    colorWarningBorderHover: "#b58900",
    colorWarningHover: "#c89a17",
    colorWarningActive: "#967100",
    colorWarningText: "#b58900",
    colorWarningTextHover: "#cc9c12",
    colorWarningTextActive: "#967100",
    colorErrorBg: "#3b1712",
    colorErrorBgHover: "#4c1d16",
    colorErrorBorder: "#8f3a2e",
    colorErrorBorderHover: "#dc322f",
    colorErrorHover: "#f14d49",
    colorErrorActive: "#b82b28",
    colorErrorText: "#dc322f",
    colorErrorTextHover: "#ef5753",
    colorErrorTextActive: "#b82b28",
    colorInfoBg: "#093b39",
    colorInfoBgHover: "#0d4a47",
    colorInfoBorder: "#216f6a",
    colorInfoBorderHover: "#2aa198",
    colorInfoHover: "#39bbb1",
    colorInfoActive: "#1f837c",
    colorInfoText: "#2aa198",
    colorInfoTextHover: "#42c8bf",
    colorInfoTextActive: "#1f837c",
    colorText: "#93a1a1",
    colorTextSecondary: "#839496",
    colorTextTertiary: "#657b83",
    colorTextQuaternary: "#586e75",
    colorTextDisabled: "#586e75",
    colorTextPlaceholder: "#657b83",
    colorBgContainer: "#073642",
    colorBgElevated: "#0b3b47",
    colorBgLayout: "#001f27",
    colorBgSpotlight: "rgba(147, 161, 161, 0.88)",
    colorBgMask: "rgba(0, 20, 26, 0.72)",
    colorBorder: "#2d5662",
    colorBorderSecondary: "#18424f",
    borderRadius: 8,
    borderRadiusXS: 2,
    borderRadiusSM: 4,
    borderRadiusLG: 10,
    padding: 16,
    paddingSM: 12,
    paddingLG: 24,
    margin: 16,
    marginSM: 12,
    marginLG: 24,
    boxShadow: "0 1px 0 rgba(147, 161, 161, 0.04)",
    boxShadowSecondary: "0 18px 42px rgba(0, 10, 14, 0.42)"
  },
  components: {
    ...sharedComponents,
    Button: {
      ...sharedComponents?.Button,
      defaultBg: "#073642",
      defaultColor: "#93a1a1",
      defaultBorderColor: "#2d5662",
      defaultHoverBg: "#0b3b47",
      defaultHoverColor: "#4ab0f4",
      defaultHoverBorderColor: "#268bd2",
      defaultActiveBg: "#073642",
      defaultActiveColor: "#268bd2",
      defaultActiveBorderColor: "#1f73b0"
    },
    Card: {
      ...sharedComponents?.Card,
      headerBg: "#073642",
      extraColor: "#839496"
    },
    Input: {
      hoverBorderColor: "#268bd2",
      activeBorderColor: "#268bd2",
      activeShadow: "0 0 0 1px rgba(38, 139, 210, 0.24)",
      hoverBg: "#002b36",
      activeBg: "#002b36"
    },
    Tag: {
      defaultBg: "#093b39",
      defaultColor: "#2aa198"
    },
    Timeline: {
      ...sharedComponents?.Timeline,
      dotBg: "#268bd2",
      tailColor: "#2d5662"
    },
    Progress: {
      defaultColor: "#268bd2",
      remainingColor: "#2d5662"
    }
  }
};

export const paperAntdTheme: ThemeConfig = {
  algorithm: antTheme.defaultAlgorithm,
  token: {
    colorPrimary: "#467c8a",
    colorSuccess: "#6f8f4e",
    colorWarning: "#c28b3c",
    colorError: "#b55d5d",
    colorInfo: "#5f7aa3",
    colorTextBase: "#4b463c",
    colorBgBase: "#f7f1e3",
    colorPrimaryBg: "#e8f0ee",
    colorPrimaryBgHover: "#d8e6e2",
    colorPrimaryBorder: "#b7c8c5",
    colorPrimaryBorderHover: "#467c8a",
    colorPrimaryHover: "#356875",
    colorPrimaryActive: "#2b5661",
    colorPrimaryText: "#467c8a",
    colorPrimaryTextHover: "#356875",
    colorPrimaryTextActive: "#2b5661",
    colorSuccessBg: "#edf2e3",
    colorSuccessBgHover: "#e0e8d2",
    colorSuccessBorder: "#b8c5a0",
    colorSuccessBorderHover: "#6f8f4e",
    colorSuccessHover: "#5f7b42",
    colorSuccessActive: "#506937",
    colorSuccessText: "#6f8f4e",
    colorSuccessTextHover: "#5f7b42",
    colorSuccessTextActive: "#506937",
    colorWarningBg: "#f6ead7",
    colorWarningBgHover: "#efddc0",
    colorWarningBorder: "#d9bc8b",
    colorWarningBorderHover: "#c28b3c",
    colorWarningHover: "#ad7930",
    colorWarningActive: "#926628",
    colorWarningText: "#c28b3c",
    colorWarningTextHover: "#ad7930",
    colorWarningTextActive: "#926628",
    colorErrorBg: "#f5e3e1",
    colorErrorBgHover: "#edd1ce",
    colorErrorBorder: "#d2acab",
    colorErrorBorderHover: "#b55d5d",
    colorErrorHover: "#9d4f4f",
    colorErrorActive: "#864242",
    colorErrorText: "#b55d5d",
    colorErrorTextHover: "#9d4f4f",
    colorErrorTextActive: "#864242",
    colorInfoBg: "#e8ecf4",
    colorInfoBgHover: "#d8dfec",
    colorInfoBorder: "#bbc6da",
    colorInfoBorderHover: "#5f7aa3",
    colorInfoHover: "#4f678a",
    colorInfoActive: "#445873",
    colorInfoText: "#5f7aa3",
    colorInfoTextHover: "#4f678a",
    colorInfoTextActive: "#445873",
    colorText: "#4b463c",
    colorTextSecondary: "#6a665c",
    colorTextTertiary: "#8b877d",
    colorTextQuaternary: "#aaa59c",
    colorTextDisabled: "#aaa59c",
    colorTextPlaceholder: "#8b877d",
    colorBgContainer: "#fffaf0",
    colorBgElevated: "#fffdf7",
    colorBgLayout: "#efe8d5",
    colorBgSpotlight: "rgba(75, 70, 60, 0.84)",
    colorBgMask: "rgba(75, 70, 60, 0.2)",
    colorBorder: "#d8cdb6",
    colorBorderSecondary: "#ebe2d0",
    borderRadius: 10,
    borderRadiusXS: 2,
    borderRadiusSM: 6,
    borderRadiusLG: 12,
    padding: 16,
    paddingSM: 12,
    paddingLG: 24,
    margin: 16,
    marginSM: 12,
    marginLG: 24,
    boxShadow: "0 1px 3px rgba(75, 70, 60, 0.08)",
    boxShadowSecondary: "0 18px 40px rgba(139, 135, 125, 0.14)"
  },
  components: {
    ...sharedComponents,
    Button: {
      ...sharedComponents?.Button,
      defaultBg: "#fffaf0",
      defaultColor: "#4b463c",
      defaultBorderColor: "#d8cdb6",
      defaultHoverBg: "#fffdf7",
      defaultHoverColor: "#356875",
      defaultHoverBorderColor: "#467c8a",
      defaultActiveBg: "#fffaf0",
      defaultActiveColor: "#2b5661",
      defaultActiveBorderColor: "#2b5661"
    },
    Card: {
      ...sharedComponents?.Card,
      headerBg: "#fffaf0",
      extraColor: "#6a665c"
    },
    Input: {
      hoverBorderColor: "#467c8a",
      activeBorderColor: "#467c8a",
      activeShadow: "0 0 0 1px rgba(70, 124, 138, 0.2)",
      hoverBg: "#fffdf7",
      activeBg: "#fffdf7"
    },
    Tag: {
      defaultBg: "#e8f0ee",
      defaultColor: "#467c8a"
    },
    Timeline: {
      ...sharedComponents?.Timeline,
      dotBg: "#467c8a",
      tailColor: "#d8cdb6"
    },
    Progress: {
      defaultColor: "#467c8a",
      remainingColor: "#ebe2d0"
    }
  }
};

export const appThemeOptions: Array<{ label: string; value: AppThemeMode }> = [
  { label: "Light", value: "light" },
  { label: "Dark", value: "dark" },
  { label: "Cyber Neon", value: "cyber" },
  { label: "Forge", value: "forge" },
  { label: "Forge Light", value: "forge-light" },
  { label: "GitHub Dark", value: "github" },
  { label: "GitHub Light", value: "github-light" },
  { label: "Nord", value: "nord" },
  { label: "Solarized Light", value: "solarized-light" },
  { label: "Gruvbox Dark", value: "gruvbox-dark" },
  { label: "High Contrast", value: "high-contrast" },
  { label: "Tokyo Night", value: "tokyo-night" },
  { label: "Solarized Dark", value: "solarized-dark" },
  { label: "Paper", value: "paper" }
];

export const isDarkAppTheme = (mode: AppThemeMode): boolean =>
  mode === "dark" ||
  mode === "cyber" ||
  mode === "forge" ||
  mode === "github" ||
  mode === "nord" ||
  mode === "gruvbox-dark" ||
  mode === "high-contrast" ||
  mode === "tokyo-night" ||
  mode === "solarized-dark";

export const getAppAntdTheme = (mode: AppThemeMode): ThemeConfig => {
  switch (mode) {
    case "dark":
      return darkAntdTheme;
    case "cyber":
      return cyberAntdTheme;
    case "forge":
      return forgeAntdTheme;
    case "forge-light":
      return forgeLightAntdTheme;
    case "github":
      return githubAntdTheme;
    case "github-light":
      return githubLightAntdTheme;
    case "nord":
      return nordAntdTheme;
    case "solarized-light":
      return solarizedLightAntdTheme;
    case "gruvbox-dark":
      return gruvboxDarkAntdTheme;
    case "high-contrast":
      return highContrastAntdTheme;
    case "tokyo-night":
      return tokyoNightAntdTheme;
    case "solarized-dark":
      return solarizedDarkAntdTheme;
    case "paper":
      return paperAntdTheme;
    default:
      return lightAntdTheme;
  }
};
