import { theme as antTheme, type ThemeConfig } from "antd";

export type AppThemeMode = "graphite-light" | "graphite-dark";

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

export const graphiteLightAntdTheme: ThemeConfig = {
  algorithm: antTheme.defaultAlgorithm,
  token: {
    colorPrimary: "#2f6feb",
    colorSuccess: "#2d7a54",
    colorWarning: "#8a7318",
    colorError: "#be3b3b",
    colorInfo: "#2f6feb",
    colorTextBase: "#1a1d21",
    colorBgBase: "#f7f8f9",
    colorPrimaryBg: "#e8f0fd",
    colorPrimaryBgHover: "#ccdaf8",
    colorPrimaryBorder: "#9cbaf2",
    colorPrimaryBorderHover: "#2f6feb",
    colorPrimaryHover: "#1f56c7",
    colorPrimaryActive: "#1248b0",
    colorPrimaryText: "#2f6feb",
    colorPrimaryTextHover: "#1f56c7",
    colorPrimaryTextActive: "#1248b0",
    colorSuccessBg: "#e6f5ee",
    colorSuccessBgHover: "#c6e6d5",
    colorSuccessBorder: "#8cc4a8",
    colorSuccessBorderHover: "#2d7a54",
    colorSuccessHover: "#226644",
    colorSuccessActive: "#185234",
    colorSuccessText: "#2d7a54",
    colorSuccessTextHover: "#226644",
    colorSuccessTextActive: "#185234",
    colorWarningBg: "#f8f5e4",
    colorWarningBgHover: "#f0e7b8",
    colorWarningBorder: "#d8c660",
    colorWarningBorderHover: "#8a7318",
    colorWarningHover: "#726010",
    colorWarningActive: "#5a4c0c",
    colorWarningText: "#8a7318",
    colorWarningTextHover: "#726010",
    colorWarningTextActive: "#5a4c0c",
    colorErrorBg: "#faeae8",
    colorErrorBgHover: "#f2d0cc",
    colorErrorBorder: "#e0a8a4",
    colorErrorBorderHover: "#be3b3b",
    colorErrorHover: "#a83030",
    colorErrorActive: "#922525",
    colorErrorText: "#be3b3b",
    colorErrorTextHover: "#a83030",
    colorErrorTextActive: "#922525",
    colorInfoBg: "#e8f0fd",
    colorInfoBgHover: "#ccdaf8",
    colorInfoBorder: "#9cbaf2",
    colorInfoBorderHover: "#2f6feb",
    colorInfoHover: "#1f56c7",
    colorInfoActive: "#1248b0",
    colorInfoText: "#2f6feb",
    colorInfoTextHover: "#1f56c7",
    colorInfoTextActive: "#1248b0",
    colorText: "#2e3238",
    colorTextSecondary: "#5b636b",
    colorTextTertiary: "#8e969e",
    colorTextQuaternary: "#c0c6cc",
    colorTextDisabled: "#c0c6cc",
    colorTextPlaceholder: "#7a8490",
    colorBgContainer: "#ffffff",
    colorBgElevated: "#fafbfc",
    colorBgLayout: "#eef0f2",
    colorBgSpotlight: "rgba(26, 29, 33, 0.85)",
    colorBgMask: "rgba(26, 29, 33, 0.45)",
    colorBorder: "#dadde1",
    colorBorderSecondary: "#eceef1",
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
    boxShadowSecondary: "0 2px 8px 0 rgba(26, 29, 33, 0.10)"
  },
  components: {
    ...sharedComponents,
    Button: {
      ...sharedComponents?.Button,
      defaultBg: "#ffffff",
      defaultColor: "#2e3238",
      defaultBorderColor: "#dadde1",
      defaultHoverBg: "#f7f8f9",
      defaultHoverColor: "#1f56c7",
      defaultHoverBorderColor: "#2f6feb",
      defaultActiveBg: "#ffffff",
      defaultActiveColor: "#1248b0",
      defaultActiveBorderColor: "#1248b0"
    },
    Card: {
      ...sharedComponents?.Card,
      headerBg: "#ffffff",
      extraColor: "#5b636b"
    },
    Input: {
      hoverBorderColor: "#2f6feb",
      activeBorderColor: "#2f6feb",
      activeShadow: "0 0 0 1px rgba(47, 111, 235, 0.20)",
      hoverBg: "#ffffff",
      activeBg: "#ffffff"
    },
    Tag: {
      defaultBg: "#e8f0fd",
      defaultColor: "#2f6feb"
    },
    Timeline: {
      ...sharedComponents?.Timeline,
      dotBg: "#2f6feb",
      tailColor: "#dadde1"
    },
    Progress: {
      defaultColor: "#2f6feb",
      remainingColor: "#eceef1"
    }
  }
};

export const graphiteDarkAntdTheme: ThemeConfig = {
  algorithm: antTheme.darkAlgorithm,
  token: {
    colorPrimary: "#4d8dff",
    colorSuccess: "#4ba870",
    colorWarning: "#b89a3a",
    colorError: "#d06060",
    colorInfo: "#4d8dff",
    colorTextBase: "#e6e9ed",
    colorBgBase: "#0e1013",
    colorPrimaryBg: "#101a2e",
    colorPrimaryBgHover: "#152440",
    colorPrimaryBorder: "#203b6e",
    colorPrimaryBorderHover: "#4d8dff",
    colorPrimaryHover: "#6fa3ff",
    colorPrimaryActive: "#3870d4",
    colorPrimaryText: "#6fa3ff",
    colorPrimaryTextHover: "#88b5ff",
    colorPrimaryTextActive: "#4d8dff",
    colorSuccessBg: "#102018",
    colorSuccessBgHover: "#162c22",
    colorSuccessBorder: "#224a34",
    colorSuccessBorderHover: "#4ba870",
    colorSuccessHover: "#60bc85",
    colorSuccessActive: "#3a8e5c",
    colorSuccessText: "#72cc94",
    colorSuccessTextHover: "#88d8a8",
    colorSuccessTextActive: "#4ba870",
    colorWarningBg: "#201c0a",
    colorWarningBgHover: "#2e280e",
    colorWarningBorder: "#4a4018",
    colorWarningBorderHover: "#b89a3a",
    colorWarningHover: "#ccae4c",
    colorWarningActive: "#987e28",
    colorWarningText: "#d4be60",
    colorWarningTextHover: "#e0cc7a",
    colorWarningTextActive: "#b89a3a",
    colorErrorBg: "#281010",
    colorErrorBgHover: "#381818",
    colorErrorBorder: "#5a2828",
    colorErrorBorderHover: "#d06060",
    colorErrorHover: "#e07878",
    colorErrorActive: "#b84848",
    colorErrorText: "#e89090",
    colorErrorTextHover: "#f0a4a4",
    colorErrorTextActive: "#d06060",
    colorInfoBg: "#101a2e",
    colorInfoBgHover: "#152440",
    colorInfoBorder: "#203b6e",
    colorInfoBorderHover: "#4d8dff",
    colorInfoHover: "#6fa3ff",
    colorInfoActive: "#3870d4",
    colorInfoText: "#6fa3ff",
    colorInfoTextHover: "#88b5ff",
    colorInfoTextActive: "#4d8dff",
    colorText: "#d8dce2",
    colorTextSecondary: "#9aa2ab",
    colorTextTertiary: "#72787e",
    colorTextQuaternary: "#50565e",
    colorTextDisabled: "#50565e",
    colorTextPlaceholder: "#848c95",
    colorBgContainer: "#171a1f",
    colorBgElevated: "#20242b",
    colorBgLayout: "#0a0d10",
    colorBgSpotlight: "rgba(8, 10, 14, 0.92)",
    colorBgMask: "rgba(0, 0, 0, 0.60)",
    colorBorder: "#2f353d",
    colorBorderSecondary: "#20242b",
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
      defaultBg: "#171a1f",
      defaultColor: "#d8dce2",
      defaultBorderColor: "#2f353d",
      defaultHoverBg: "#1e2228",
      defaultHoverColor: "#6fa3ff",
      defaultHoverBorderColor: "#4d8dff",
      defaultActiveBg: "#141720",
      defaultActiveColor: "#4d8dff",
      defaultActiveBorderColor: "#3870d4"
    },
    Card: {
      ...sharedComponents?.Card,
      headerBg: "#171a1f",
      extraColor: "#9aa2ab"
    },
    Input: {
      hoverBorderColor: "#4d8dff",
      activeBorderColor: "#4d8dff",
      activeShadow: "0 0 0 1px rgba(77, 141, 255, 0.24)",
      hoverBg: "#0e1013",
      activeBg: "#0e1013"
    },
    Tag: {
      defaultBg: "#101a2e",
      defaultColor: "#6fa3ff"
    },
    Timeline: {
      ...sharedComponents?.Timeline,
      dotBg: "#4d8dff",
      tailColor: "#2f353d"
    },
    Progress: {
      defaultColor: "#4d8dff",
      remainingColor: "#2f353d"
    }
  }
};

export const isDarkAppTheme = (mode: AppThemeMode): boolean => mode === "graphite-dark";

export const getAppAntdTheme = (mode: AppThemeMode): ThemeConfig => {
  switch (mode) {
    case "graphite-light":
      return graphiteLightAntdTheme;
    case "graphite-dark":
      return graphiteDarkAntdTheme;
    default:
      return graphiteDarkAntdTheme;
  }
};
