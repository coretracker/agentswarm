import { theme as antTheme, type ThemeConfig } from "antd";

export type AppThemeMode =
  | "light"
  | "dark"
  | "forge"
  | "forge-light"
  | "github"
  | "github-light"
  | "verft-light"
  | "verft-dark";

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

export const verftLightAntdTheme: ThemeConfig = {
  algorithm: antTheme.defaultAlgorithm,
  token: {
    colorPrimary: "#1A7A9B",
    colorSuccess: "#2E8B57",
    colorWarning: "#C8922A",
    colorError: "#C0392B",
    colorInfo: "#4A7FB5",
    colorTextBase: "#1C2E40",
    colorBgBase: "#F5F2E8",
    colorPrimaryBg: "#E8F4F8",
    colorPrimaryBgHover: "#CCE8F2",
    colorPrimaryBorder: "#9CCEDD",
    colorPrimaryBorderHover: "#1A7A9B",
    colorPrimaryHover: "#156884",
    colorPrimaryActive: "#105E77",
    colorPrimaryText: "#1A7A9B",
    colorPrimaryTextHover: "#156884",
    colorPrimaryTextActive: "#105E77",
    colorSuccessBg: "#E8F5EE",
    colorSuccessBgHover: "#CCEAD9",
    colorSuccessBorder: "#9ECFB4",
    colorSuccessBorderHover: "#2E8B57",
    colorSuccessHover: "#267849",
    colorSuccessActive: "#1D5F3A",
    colorSuccessText: "#2E8B57",
    colorSuccessTextHover: "#267849",
    colorSuccessTextActive: "#1D5F3A",
    colorWarningBg: "#FAF3E0",
    colorWarningBgHover: "#F2E3B8",
    colorWarningBorder: "#E0C570",
    colorWarningBorderHover: "#C8922A",
    colorWarningHover: "#B47F22",
    colorWarningActive: "#9E6E1A",
    colorWarningText: "#C8922A",
    colorWarningTextHover: "#B47F22",
    colorWarningTextActive: "#9E6E1A",
    colorErrorBg: "#FAE8E6",
    colorErrorBgHover: "#F2CFCC",
    colorErrorBorder: "#E0A8A5",
    colorErrorBorderHover: "#C0392B",
    colorErrorHover: "#A63222",
    colorErrorActive: "#8C2A1D",
    colorErrorText: "#C0392B",
    colorErrorTextHover: "#A63222",
    colorErrorTextActive: "#8C2A1D",
    colorInfoBg: "#E8EFF8",
    colorInfoBgHover: "#CCDEEF",
    colorInfoBorder: "#99BDE0",
    colorInfoBorderHover: "#4A7FB5",
    colorInfoHover: "#3E6D9C",
    colorInfoActive: "#315980",
    colorInfoText: "#4A7FB5",
    colorInfoTextHover: "#3E6D9C",
    colorInfoTextActive: "#315980",
    colorText: "#2C4258",
    colorTextSecondary: "#5A7A96",
    colorTextTertiary: "#8AA5BE",
    colorTextQuaternary: "#C0D5E5",
    colorTextDisabled: "#C0D5E5",
    colorTextPlaceholder: "#7A9AB5",
    colorBgContainer: "#FFFFFF",
    colorBgElevated: "#FDFAF4",
    colorBgLayout: "#EEF6F8",
    colorBgSpotlight: "rgba(28, 46, 64, 0.85)",
    colorBgMask: "rgba(28, 46, 64, 0.45)",
    colorBorder: "#C8DBE5",
    colorBorderSecondary: "#E0ECF2",
    borderRadius: 8,
    borderRadiusXS: 2,
    borderRadiusSM: 5,
    borderRadiusLG: 12,
    padding: 16,
    paddingSM: 12,
    paddingLG: 20,
    margin: 16,
    marginSM: 12,
    marginLG: 20,
    boxShadow: "none",
    boxShadowSecondary: "0 2px 8px 0 rgba(26, 122, 155, 0.10)"
  },
  components: {
    ...sharedComponents,
    Button: {
      ...sharedComponents?.Button,
      defaultBg: "#FFFFFF",
      defaultColor: "#2C4258",
      defaultBorderColor: "#C8DBE5",
      defaultHoverBg: "#F5FAFB",
      defaultHoverColor: "#156884",
      defaultHoverBorderColor: "#1A7A9B",
      defaultActiveBg: "#FFFFFF",
      defaultActiveColor: "#105E77",
      defaultActiveBorderColor: "#105E77"
    },
    Card: {
      ...sharedComponents?.Card,
      headerBg: "#FFFFFF",
      extraColor: "#5A7A96"
    },
    Input: {
      hoverBorderColor: "#1A7A9B",
      activeBorderColor: "#1A7A9B",
      activeShadow: "0 0 0 1px rgba(26, 122, 155, 0.20)",
      hoverBg: "#FFFFFF",
      activeBg: "#FFFFFF"
    },
    Tag: {
      defaultBg: "#E8F4F8",
      defaultColor: "#1A7A9B"
    },
    Timeline: {
      ...sharedComponents?.Timeline,
      dotBg: "#1A7A9B",
      tailColor: "#C8DBE5"
    },
    Progress: {
      defaultColor: "#1A7A9B",
      remainingColor: "#E0ECF2"
    }
  }
};

export const verftDarkAntdTheme: ThemeConfig = {
  algorithm: antTheme.darkAlgorithm,
  token: {
    colorPrimary: "#D4A84B",
    colorSuccess: "#4DAA6A",
    colorWarning: "#E8C56B",
    colorError: "#D46060",
    colorInfo: "#6BAED6",
    colorTextBase: "#E8F4F8",
    colorBgBase: "#0C1822",
    colorPrimaryBg: "#2A1E08",
    colorPrimaryBgHover: "#3A2A0E",
    colorPrimaryBorder: "#5A4018",
    colorPrimaryBorderHover: "#D4A84B",
    colorPrimaryHover: "#E0B85C",
    colorPrimaryActive: "#B88E38",
    colorPrimaryText: "#E8C56B",
    colorPrimaryTextHover: "#F0D47E",
    colorPrimaryTextActive: "#D4A84B",
    colorSuccessBg: "#0E2418",
    colorSuccessBgHover: "#132E20",
    colorSuccessBorder: "#1F4D30",
    colorSuccessBorderHover: "#4DAA6A",
    colorSuccessHover: "#5FBF7C",
    colorSuccessActive: "#3D8F56",
    colorSuccessText: "#72CC90",
    colorSuccessTextHover: "#8AD9A6",
    colorSuccessTextActive: "#4DAA6A",
    colorWarningBg: "#251C06",
    colorWarningBgHover: "#342608",
    colorWarningBorder: "#4E3A0E",
    colorWarningBorderHover: "#E8C56B",
    colorWarningHover: "#F0D07A",
    colorWarningActive: "#C8A846",
    colorWarningText: "#F4D890",
    colorWarningTextHover: "#F8E3A4",
    colorWarningTextActive: "#E8C56B",
    colorErrorBg: "#281214",
    colorErrorBgHover: "#351818",
    colorErrorBorder: "#522020",
    colorErrorBorderHover: "#D46060",
    colorErrorHover: "#E07878",
    colorErrorActive: "#BC4E4E",
    colorErrorText: "#E89090",
    colorErrorTextHover: "#F0A4A4",
    colorErrorTextActive: "#D46060",
    colorInfoBg: "#0E1E2E",
    colorInfoBgHover: "#14273C",
    colorInfoBorder: "#1E3D58",
    colorInfoBorderHover: "#6BAED6",
    colorInfoHover: "#7DC0E6",
    colorInfoActive: "#569BC0",
    colorInfoText: "#95CCE8",
    colorInfoTextHover: "#A8D9F0",
    colorInfoTextActive: "#6BAED6",
    colorText: "#D8EEF4",
    colorTextSecondary: "#88AABF",
    colorTextTertiary: "#6A8EA6",
    colorTextQuaternary: "#4E6E85",
    colorTextDisabled: "#4E6E85",
    colorTextPlaceholder: "#7A9EB8",
    colorBgContainer: "#121E2A",
    colorBgElevated: "#172430",
    colorBgLayout: "#0A1520",
    colorBgSpotlight: "rgba(8, 18, 28, 0.92)",
    colorBgMask: "rgba(0, 0, 0, 0.60)",
    colorBorder: "#1E3448",
    colorBorderSecondary: "#162A3C",
    borderRadius: 8,
    borderRadiusXS: 2,
    borderRadiusSM: 5,
    borderRadiusLG: 12,
    padding: 16,
    paddingSM: 12,
    paddingLG: 20,
    margin: 16,
    marginSM: 12,
    marginLG: 20,
    boxShadow: "none",
    boxShadowSecondary: "0 8px 24px rgba(0, 0, 0, 0.40)"
  },
  components: {
    ...sharedComponents,
    Button: {
      ...sharedComponents?.Button,
      defaultBg: "#121E2A",
      defaultColor: "#D8EEF4",
      defaultBorderColor: "#1E3448",
      defaultHoverBg: "#18273A",
      defaultHoverColor: "#E8C56B",
      defaultHoverBorderColor: "#D4A84B",
      defaultActiveBg: "#0F1A24",
      defaultActiveColor: "#D4A84B",
      defaultActiveBorderColor: "#B88E38"
    },
    Card: {
      ...sharedComponents?.Card,
      headerBg: "#121E2A",
      extraColor: "#88AABF"
    },
    Input: {
      hoverBorderColor: "#D4A84B",
      activeBorderColor: "#D4A84B",
      activeShadow: "0 0 0 1px rgba(212, 168, 75, 0.24)",
      hoverBg: "#0C1822",
      activeBg: "#0C1822"
    },
    Tag: {
      defaultBg: "#2A1E08",
      defaultColor: "#E8C56B"
    },
    Timeline: {
      ...sharedComponents?.Timeline,
      dotBg: "#D4A84B",
      tailColor: "#1E3448"
    },
    Progress: {
      defaultColor: "#D4A84B",
      remainingColor: "#1E3448"
    }
  }
};

export const appThemeOptions: Array<{ label: string; value: AppThemeMode }> = [
  { label: "Agentswarm Light", value: "light" },
  { label: "Agentswarm Dark", value: "dark" },
  { label: "Forge Light", value: "forge-light" },
  { label: "Forge Dark", value: "forge" },
  { label: "Github Light", value: "github-light" },
  { label: "Github Dark", value: "github" },
  { label: "Verft Light", value: "verft-light" },
  { label: "Verft Dark", value: "verft-dark" }
];

export const isDarkAppTheme = (mode: AppThemeMode): boolean =>
  mode === "dark" ||
  mode === "forge" ||
  mode === "github" ||
  mode === "verft-dark";

export const getAppAntdTheme = (mode: AppThemeMode): ThemeConfig => {
  switch (mode) {
    case "dark":
      return darkAntdTheme;
    case "forge":
      return forgeAntdTheme;
    case "forge-light":
      return forgeLightAntdTheme;
    case "github":
      return githubAntdTheme;
    case "github-light":
      return githubLightAntdTheme;
    case "verft-light":
      return verftLightAntdTheme;
    case "verft-dark":
      return verftDarkAntdTheme;
    default:
      return lightAntdTheme;
  }
};
