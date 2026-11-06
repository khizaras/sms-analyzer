export const CATEGORY_COLORS = {
  food: '#C46B4A',
  travel: '#1D4E89',
  shopping: '#C6A15B',
  utilities: '#0F6E56',
  salary: '#2A9D8F',
  transfer: '#5C6B82',
  atm: '#7A5C45',
  emi: '#8C3A4B',
  investment: '#3D5A80',
  otp: '#8A8478',
  promo: '#A39B8B',
  other: '#98A2B3',
};

export const BANK_COLORS = {
  'HDFC Bank': '#004C8F',
  'ICICI Bank': '#B45309',
  'SBI': '#1D4ED8',
  'Axis Bank': '#7C2D4A',
  Kotak: '#9F1239',
};

export function bankColor(name) {
  return BANK_COLORS[name] || '#0F6E56';
}

const theme = {
  token: {
    colorPrimary: '#0F6E56',
    colorInfo: '#1D4E89',
    colorSuccess: '#0F6E56',
    colorWarning: '#A6843D',
    colorError: '#8F3D3D',
    colorText: '#142033',
    colorTextSecondary: '#5C6B82',
    colorBgLayout: '#F3EFE6',
    colorBgContainer: '#FFFDF8',
    colorBorder: 'rgba(20, 32, 51, 0.1)',
    borderRadius: 12,
    borderRadiusLG: 18,
    fontFamily: '"Outfit", "Segoe UI", sans-serif',
    fontSize: 14.5,
    controlHeight: 42,
    boxShadow: '0 12px 32px rgba(20, 32, 51, 0.06)',
    boxShadowSecondary: '0 18px 50px rgba(20, 32, 51, 0.1)',
  },
  components: {
    Button: {
      fontWeight: 600,
      primaryShadow: 'none',
      defaultShadow: 'none',
    },
    Input: { activeShadow: '0 0 0 3px rgba(15, 110, 86, 0.12)' },
    Select: { optionSelectedBg: '#E7F3EE' },
    Table: {
      headerBg: '#F6F1E6',
      headerColor: '#3E4C63',
      headerSplitColor: 'transparent',
      rowHoverBg: '#FBF6EE',
      borderColor: 'rgba(20, 32, 51, 0.06)',
    },
    Menu: {
      darkItemBg: 'transparent',
      darkItemSelectedBg: 'rgba(198, 161, 91, 0.16)',
      darkItemSelectedColor: '#F3E6C4',
      darkItemColor: '#C9D0DE',
      darkItemHoverBg: 'rgba(255,255,255,0.04)',
    },
    Segmented: {
      itemSelectedBg: '#142033',
      itemSelectedColor: '#F6F1E6',
      trackBg: '#EFE8DA',
    },
    Drawer: { footerPaddingBlock: 16 },
  },
};

export default theme;
