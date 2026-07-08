import { theme as antTheme, type ThemeConfig } from "antd";

export type AppThemeMode =
  | "ember-light"
  | "ember-dark"
  | "moss-light"
  | "moss-dark"
  | "graphite-light"
  | "graphite-dark";

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

export const emberLightAntdTheme: ThemeConfig = {
  algorithm: antTheme.defaultAlgorithm,
  token: {
    colorPrimary: "#d2531f",
    colorSuccess: "#4d7c4a",
    colorWarning: "#b87d23",
    colorError: "#b83c2b",
    colorInfo: "#4e6e99",
    colorTextBase: "#2b1a12",
    colorBgBase: "#fbf7f4",
    colorPrimaryBg: "#faeee7",
    colorPrimaryBgHover: "#f5ddd0",
    colorPrimaryBorder: "#ebbfa8",
    colorPrimaryBorderHover: "#d2531f",
    colorPrimaryHover: "#b23f12",
    colorPrimaryActive: "#922e0c",
    colorPrimaryText: "#d2531f",
    colorPrimaryTextHover: "#b23f12",
    colorPrimaryTextActive: "#922e0c",
    colorSuccessBg: "#eef5ee",
    colorSuccessBgHover: "#d5e8d6",
    colorSuccessBorder: "#a8ccaa",
    colorSuccessBorderHover: "#4d7c4a",
    colorSuccessHover: "#3e6840",
    colorSuccessActive: "#2d5130",
    colorSuccessText: "#4d7c4a",
    colorSuccessTextHover: "#3e6840",
    colorSuccessTextActive: "#2d5130",
    colorWarningBg: "#faf4e4",
    colorWarningBgHover: "#f2e5c0",
    colorWarningBorder: "#e0c87a",
    colorWarningBorderHover: "#b87d23",
    colorWarningHover: "#a06c1a",
    colorWarningActive: "#8a5c12",
    colorWarningText: "#b87d23",
    colorWarningTextHover: "#a06c1a",
    colorWarningTextActive: "#8a5c12",
    colorErrorBg: "#faeae8",
    colorErrorBgHover: "#f2d0cc",
    colorErrorBorder: "#e0aba6",
    colorErrorBorderHover: "#b83c2b",
    colorErrorHover: "#a03422",
    colorErrorActive: "#892b1a",
    colorErrorText: "#b83c2b",
    colorErrorTextHover: "#a03422",
    colorErrorTextActive: "#892b1a",
    colorInfoBg: "#eaeff7",
    colorInfoBgHover: "#d0dcee",
    colorInfoBorder: "#a0bbdc",
    colorInfoBorderHover: "#4e6e99",
    colorInfoHover: "#3e5c88",
    colorInfoActive: "#2e4c76",
    colorInfoText: "#4e6e99",
    colorInfoTextHover: "#3e5c88",
    colorInfoTextActive: "#2e4c76",
    colorText: "#4a2e20",
    colorTextSecondary: "#6b5347",
    colorTextTertiary: "#9e7c6d",
    colorTextQuaternary: "#cbb5ac",
    colorTextDisabled: "#cbb5ac",
    colorTextPlaceholder: "#8e6e62",
    colorBgContainer: "#ffffff",
    colorBgElevated: "#fdf9f7",
    colorBgLayout: "#f5ebe4",
    colorBgSpotlight: "rgba(43, 26, 18, 0.85)",
    colorBgMask: "rgba(43, 26, 18, 0.45)",
    colorBorder: "#e5d3c6",
    colorBorderSecondary: "#f0e4da",
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
    boxShadowSecondary: "0 2px 8px 0 rgba(43, 26, 18, 0.10)"
  },
  components: {
    ...sharedComponents,
    Button: {
      ...sharedComponents?.Button,
      defaultBg: "#ffffff",
      defaultColor: "#4a2e20",
      defaultBorderColor: "#e5d3c6",
      defaultHoverBg: "#fdf6f2",
      defaultHoverColor: "#b23f12",
      defaultHoverBorderColor: "#d2531f",
      defaultActiveBg: "#ffffff",
      defaultActiveColor: "#922e0c",
      defaultActiveBorderColor: "#922e0c"
    },
    Card: {
      ...sharedComponents?.Card,
      headerBg: "#ffffff",
      extraColor: "#6b5347"
    },
    Input: {
      hoverBorderColor: "#d2531f",
      activeBorderColor: "#d2531f",
      activeShadow: "0 0 0 1px rgba(210, 83, 31, 0.20)",
      hoverBg: "#ffffff",
      activeBg: "#ffffff"
    },
    Tag: {
      defaultBg: "#faeee7",
      defaultColor: "#d2531f"
    },
    Timeline: {
      ...sharedComponents?.Timeline,
      dotBg: "#d2531f",
      tailColor: "#e5d3c6"
    },
    Progress: {
      defaultColor: "#d2531f",
      remainingColor: "#f0e4da"
    }
  }
};

export const emberDarkAntdTheme: ThemeConfig = {
  algorithm: antTheme.darkAlgorithm,
  token: {
    colorPrimary: "#f26b36",
    colorSuccess: "#5c9e5f",
    colorWarning: "#e8aa45",
    colorError: "#d05050",
    colorInfo: "#6895c0",
    colorTextBase: "#f2e6dd",
    colorBgBase: "#1a120e",
    colorPrimaryBg: "#2e1a0e",
    colorPrimaryBgHover: "#3e2414",
    colorPrimaryBorder: "#5e3420",
    colorPrimaryBorderHover: "#f26b36",
    colorPrimaryHover: "#ff824f",
    colorPrimaryActive: "#d45a28",
    colorPrimaryText: "#f2814c",
    colorPrimaryTextHover: "#ff9060",
    colorPrimaryTextActive: "#f26b36",
    colorSuccessBg: "#162214",
    colorSuccessBgHover: "#1e2e1c",
    colorSuccessBorder: "#2e4c2e",
    colorSuccessBorderHover: "#5c9e5f",
    colorSuccessHover: "#70b273",
    colorSuccessActive: "#4a8650",
    colorSuccessText: "#80c884",
    colorSuccessTextHover: "#94d498",
    colorSuccessTextActive: "#5c9e5f",
    colorWarningBg: "#2a1e0a",
    colorWarningBgHover: "#382810",
    colorWarningBorder: "#58401a",
    colorWarningBorderHover: "#e8aa45",
    colorWarningHover: "#f0bc58",
    colorWarningActive: "#c8902e",
    colorWarningText: "#f4c870",
    colorWarningTextHover: "#f8d488",
    colorWarningTextActive: "#e8aa45",
    colorErrorBg: "#2a1412",
    colorErrorBgHover: "#381c1a",
    colorErrorBorder: "#5a2c28",
    colorErrorBorderHover: "#d05050",
    colorErrorHover: "#e06868",
    colorErrorActive: "#b84040",
    colorErrorText: "#e88888",
    colorErrorTextHover: "#f0a0a0",
    colorErrorTextActive: "#d05050",
    colorInfoBg: "#141e2a",
    colorInfoBgHover: "#1a2838",
    colorInfoBorder: "#223a54",
    colorInfoBorderHover: "#6895c0",
    colorInfoHover: "#80aad0",
    colorInfoActive: "#5280aa",
    colorInfoText: "#8bbcd8",
    colorInfoTextHover: "#a0cce8",
    colorInfoTextActive: "#6895c0",
    colorText: "#e8ddd4",
    colorTextSecondary: "#c0a597",
    colorTextTertiary: "#a08070",
    colorTextQuaternary: "#7a6055",
    colorTextDisabled: "#7a6055",
    colorTextPlaceholder: "#b09080",
    colorBgContainer: "#241811",
    colorBgElevated: "#2e2018",
    colorBgLayout: "#140e0a",
    colorBgSpotlight: "rgba(20, 10, 6, 0.92)",
    colorBgMask: "rgba(0, 0, 0, 0.60)",
    colorBorder: "#3e2c21",
    colorBorderSecondary: "#2e2018",
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
      defaultBg: "#241811",
      defaultColor: "#e8ddd4",
      defaultBorderColor: "#3e2c21",
      defaultHoverBg: "#2e2018",
      defaultHoverColor: "#f2b45a",
      defaultHoverBorderColor: "#f26b36",
      defaultActiveBg: "#1e1410",
      defaultActiveColor: "#f26b36",
      defaultActiveBorderColor: "#d45a28"
    },
    Card: {
      ...sharedComponents?.Card,
      headerBg: "#241811",
      extraColor: "#c0a597"
    },
    Input: {
      hoverBorderColor: "#f26b36",
      activeBorderColor: "#f26b36",
      activeShadow: "0 0 0 1px rgba(242, 107, 54, 0.24)",
      hoverBg: "#1a120e",
      activeBg: "#1a120e"
    },
    Tag: {
      defaultBg: "#2e1a0e",
      defaultColor: "#f2814c"
    },
    Timeline: {
      ...sharedComponents?.Timeline,
      dotBg: "#f26b36",
      tailColor: "#3e2c21"
    },
    Progress: {
      defaultColor: "#f26b36",
      remainingColor: "#3e2c21"
    }
  }
};

export const mossLightAntdTheme: ThemeConfig = {
  algorithm: antTheme.defaultAlgorithm,
  token: {
    colorPrimary: "#3e7c41",
    colorSuccess: "#2e6b3a",
    colorWarning: "#9a7e3c",
    colorError: "#b8352a",
    colorInfo: "#45708a",
    colorTextBase: "#1b2a17",
    colorBgBase: "#f6f8f4",
    colorPrimaryBg: "#e8f2e8",
    colorPrimaryBgHover: "#ccdfcc",
    colorPrimaryBorder: "#9ec99f",
    colorPrimaryBorderHover: "#3e7c41",
    colorPrimaryHover: "#2e5f31",
    colorPrimaryActive: "#1f4a22",
    colorPrimaryText: "#3e7c41",
    colorPrimaryTextHover: "#2e5f31",
    colorPrimaryTextActive: "#1f4a22",
    colorSuccessBg: "#e4f0e6",
    colorSuccessBgHover: "#c6e0c8",
    colorSuccessBorder: "#8cbd90",
    colorSuccessBorderHover: "#2e6b3a",
    colorSuccessHover: "#235830",
    colorSuccessActive: "#184424",
    colorSuccessText: "#2e6b3a",
    colorSuccessTextHover: "#235830",
    colorSuccessTextActive: "#184424",
    colorWarningBg: "#f8f4e6",
    colorWarningBgHover: "#f0e6c0",
    colorWarningBorder: "#dcc878",
    colorWarningBorderHover: "#9a7e3c",
    colorWarningHover: "#826832",
    colorWarningActive: "#6c5428",
    colorWarningText: "#9a7e3c",
    colorWarningTextHover: "#826832",
    colorWarningTextActive: "#6c5428",
    colorErrorBg: "#faebe9",
    colorErrorBgHover: "#f2d0cc",
    colorErrorBorder: "#e0a8a4",
    colorErrorBorderHover: "#b8352a",
    colorErrorHover: "#9e2c22",
    colorErrorActive: "#85231a",
    colorErrorText: "#b8352a",
    colorErrorTextHover: "#9e2c22",
    colorErrorTextActive: "#85231a",
    colorInfoBg: "#e8eff5",
    colorInfoBgHover: "#ccddea",
    colorInfoBorder: "#8ab0c8",
    colorInfoBorderHover: "#45708a",
    colorInfoHover: "#375e78",
    colorInfoActive: "#2a4e66",
    colorInfoText: "#45708a",
    colorInfoTextHover: "#375e78",
    colorInfoTextActive: "#2a4e66",
    colorText: "#2d4428",
    colorTextSecondary: "#4f6146",
    colorTextTertiary: "#8a9e7e",
    colorTextQuaternary: "#b8ccb0",
    colorTextDisabled: "#b8ccb0",
    colorTextPlaceholder: "#728462",
    colorBgContainer: "#ffffff",
    colorBgElevated: "#fbfdf9",
    colorBgLayout: "#eaf0e4",
    colorBgSpotlight: "rgba(27, 42, 23, 0.85)",
    colorBgMask: "rgba(27, 42, 23, 0.45)",
    colorBorder: "#d2dec7",
    colorBorderSecondary: "#e6eede",
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
    boxShadowSecondary: "0 2px 8px 0 rgba(27, 42, 23, 0.10)"
  },
  components: {
    ...sharedComponents,
    Button: {
      ...sharedComponents?.Button,
      defaultBg: "#ffffff",
      defaultColor: "#2d4428",
      defaultBorderColor: "#d2dec7",
      defaultHoverBg: "#f6faf5",
      defaultHoverColor: "#2e5f31",
      defaultHoverBorderColor: "#3e7c41",
      defaultActiveBg: "#ffffff",
      defaultActiveColor: "#1f4a22",
      defaultActiveBorderColor: "#1f4a22"
    },
    Card: {
      ...sharedComponents?.Card,
      headerBg: "#ffffff",
      extraColor: "#4f6146"
    },
    Input: {
      hoverBorderColor: "#3e7c41",
      activeBorderColor: "#3e7c41",
      activeShadow: "0 0 0 1px rgba(62, 124, 65, 0.20)",
      hoverBg: "#ffffff",
      activeBg: "#ffffff"
    },
    Tag: {
      defaultBg: "#e8f2e8",
      defaultColor: "#3e7c41"
    },
    Timeline: {
      ...sharedComponents?.Timeline,
      dotBg: "#3e7c41",
      tailColor: "#d2dec7"
    },
    Progress: {
      defaultColor: "#3e7c41",
      remainingColor: "#e6eede"
    }
  }
};

export const mossDarkAntdTheme: ThemeConfig = {
  algorithm: antTheme.darkAlgorithm,
  token: {
    colorPrimary: "#5da35f",
    colorSuccess: "#4a9452",
    colorWarning: "#c8a85a",
    colorError: "#c85a55",
    colorInfo: "#6ba0bc",
    colorTextBase: "#e4eee2",
    colorBgBase: "#0f1710",
    colorPrimaryBg: "#152018",
    colorPrimaryBgHover: "#1c2c1e",
    colorPrimaryBorder: "#2c4a30",
    colorPrimaryBorderHover: "#5da35f",
    colorPrimaryHover: "#74be76",
    colorPrimaryActive: "#4a8a4c",
    colorPrimaryText: "#72b874",
    colorPrimaryTextHover: "#88c88a",
    colorPrimaryTextActive: "#5da35f",
    colorSuccessBg: "#132018",
    colorSuccessBgHover: "#1a2c20",
    colorSuccessBorder: "#2a4830",
    colorSuccessBorderHover: "#4a9452",
    colorSuccessHover: "#5eaa66",
    colorSuccessActive: "#3a7a44",
    colorSuccessText: "#6cbe74",
    colorSuccessTextHover: "#82cc88",
    colorSuccessTextActive: "#4a9452",
    colorWarningBg: "#22200a",
    colorWarningBgHover: "#302e0e",
    colorWarningBorder: "#4a4418",
    colorWarningBorderHover: "#c8a85a",
    colorWarningHover: "#d8bc6c",
    colorWarningActive: "#a88840",
    colorWarningText: "#e0cc80",
    colorWarningTextHover: "#e8d898",
    colorWarningTextActive: "#c8a85a",
    colorErrorBg: "#281414",
    colorErrorBgHover: "#341c1c",
    colorErrorBorder: "#543030",
    colorErrorBorderHover: "#c85a55",
    colorErrorHover: "#d87270",
    colorErrorActive: "#b04848",
    colorErrorText: "#e09090",
    colorErrorTextHover: "#e8a4a4",
    colorErrorTextActive: "#c85a55",
    colorInfoBg: "#102030",
    colorInfoBgHover: "#162a3c",
    colorInfoBorder: "#204058",
    colorInfoBorderHover: "#6ba0bc",
    colorInfoHover: "#82b4cc",
    colorInfoActive: "#5288a4",
    colorInfoText: "#90bcd0",
    colorInfoTextHover: "#a4ccde",
    colorInfoTextActive: "#6ba0bc",
    colorText: "#d4e8d0",
    colorTextSecondary: "#a0b49e",
    colorTextTertiary: "#7a9878",
    colorTextQuaternary: "#567855",
    colorTextDisabled: "#567855",
    colorTextPlaceholder: "#90aa8e",
    colorBgContainer: "#17231a",
    colorBgElevated: "#1f2e22",
    colorBgLayout: "#0c140e",
    colorBgSpotlight: "rgba(10, 18, 10, 0.92)",
    colorBgMask: "rgba(0, 0, 0, 0.60)",
    colorBorder: "#2c3e30",
    colorBorderSecondary: "#1f2e22",
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
      defaultBg: "#17231a",
      defaultColor: "#d4e8d0",
      defaultBorderColor: "#2c3e30",
      defaultHoverBg: "#1e2e22",
      defaultHoverColor: "#c8a85a",
      defaultHoverBorderColor: "#5da35f",
      defaultActiveBg: "#131e16",
      defaultActiveColor: "#5da35f",
      defaultActiveBorderColor: "#4a8a4c"
    },
    Card: {
      ...sharedComponents?.Card,
      headerBg: "#17231a",
      extraColor: "#a0b49e"
    },
    Input: {
      hoverBorderColor: "#5da35f",
      activeBorderColor: "#5da35f",
      activeShadow: "0 0 0 1px rgba(93, 163, 95, 0.24)",
      hoverBg: "#0f1710",
      activeBg: "#0f1710"
    },
    Tag: {
      defaultBg: "#152018",
      defaultColor: "#72b874"
    },
    Timeline: {
      ...sharedComponents?.Timeline,
      dotBg: "#5da35f",
      tailColor: "#2c3e30"
    },
    Progress: {
      defaultColor: "#5da35f",
      remainingColor: "#2c3e30"
    }
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

export const appThemeOptions: Array<{ label: string; value: AppThemeMode }> = [
  { label: "Ember Light", value: "ember-light" },
  { label: "Ember Dark", value: "ember-dark" },
  { label: "Moss Light", value: "moss-light" },
  { label: "Moss Dark", value: "moss-dark" },
  { label: "Graphite Light", value: "graphite-light" },
  { label: "Graphite Dark", value: "graphite-dark" }
];

export const isDarkAppTheme = (mode: AppThemeMode): boolean =>
  mode === "ember-dark" ||
  mode === "moss-dark" ||
  mode === "graphite-dark";

export const getAppAntdTheme = (mode: AppThemeMode): ThemeConfig => {
  switch (mode) {
    case "ember-light":
      return emberLightAntdTheme;
    case "ember-dark":
      return emberDarkAntdTheme;
    case "moss-light":
      return mossLightAntdTheme;
    case "moss-dark":
      return mossDarkAntdTheme;
    case "graphite-light":
      return graphiteLightAntdTheme;
    case "graphite-dark":
      return graphiteDarkAntdTheme;
    default:
      return mossDarkAntdTheme;
  }
};
