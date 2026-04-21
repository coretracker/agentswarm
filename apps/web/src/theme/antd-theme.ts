import { theme as antTheme, type ThemeConfig } from "antd";

export type AppThemeMode = "light" | "dark" | "cyber";

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

export const appThemeOptions: Array<{ label: string; value: AppThemeMode }> = [
  { label: "Light", value: "light" },
  { label: "Dark", value: "dark" },
  { label: "Cyber Neon", value: "cyber" }
];

export const isDarkAppTheme = (mode: AppThemeMode): boolean => mode !== "light";

export const getAppAntdTheme = (mode: AppThemeMode): ThemeConfig => {
  switch (mode) {
    case "dark":
      return darkAntdTheme;
    case "cyber":
      return cyberAntdTheme;
    default:
      return lightAntdTheme;
  }
};
