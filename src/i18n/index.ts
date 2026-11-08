import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import ar from "./ar.json";

// Keys are the English strings themselves (keySeparator disabled), so English needs no file.
void i18n.use(initReactI18next).init({
  resources: { en: { translation: {} }, ar: { translation: ar } },
  lng: "en",
  fallbackLng: "en",
  keySeparator: false,
  nsSeparator: false,
  interpolation: { escapeValue: false },
  returnEmptyString: false,
});

export function applyLanguage(lng: "en" | "ar") {
  void i18n.changeLanguage(lng);
  document.documentElement.lang = lng;
  document.documentElement.dir = lng === "ar" ? "rtl" : "ltr";
}

export default i18n;
