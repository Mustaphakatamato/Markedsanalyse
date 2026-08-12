import Icon from "./Icon";

// Statuschip. Farven står aldrig alene — der følger altid et ikon OG en
// tekst med, så tilstanden også kan læses uden farvesyn og i sort/hvid print.

const TONES = {
  ok: { className: "chip-ok", icon: "check" },
  alert: { className: "chip-alert", icon: "alert" },
  warn: { className: "chip-warn", icon: "info" },
  info: { className: "chip-info", icon: "info" },
  neutral: { className: "", icon: null }
};

/**
 * @param {{ tone?: keyof typeof TONES, icon?: string|null, size?: "sm"|"lg", children: React.ReactNode }} props
 */
export default function StatusChip({ tone = "neutral", icon, size = "sm", children, ...rest }) {
  const def = TONES[tone] || TONES.neutral;
  const iconName = icon === undefined ? def.icon : icon;

  return (
    <span className={`chip ${def.className} ${size === "lg" ? "chip-lg" : ""}`.trim()} {...rest}>
      {iconName ? <Icon name={iconName} size={12} strokeWidth={1.8} /> : <i className="chip__dot" />}
      {children}
    </span>
  );
}
