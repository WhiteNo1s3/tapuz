# Hebrew & RTL Support in Tapuz

**RTL is not an afterthought.** It is a core requirement.

## Requirements

- All public pages must render correctly in RTL by default
- Admin panel should support Hebrew UI (at minimum labels + directions)
- Content is primarily Hebrew (we may add English later)
- Direction should be easy to control per page or per theme if needed
- No broken layouts when using Hebrew text

## Technical Approach

### 1. HTML Direction
- Use `dir="rtl"` and `lang="he"` on the `<html>` tag for Hebrew pages
- Themes must respect `dir="rtl"`
- CSS should use logical properties where possible:
  - `margin-inline-start` instead of `margin-left`
  - `padding-inline-end` instead of `padding-right`
  - `text-align: start` / `end`
  - `flex-direction` with care

### 2. Theme Standard Updates (RTL)
Themes **must** support RTL properly. `theme.json` should declare RTL support:

```json
{
  "name": "...",
  "rtl": true,
  "supports": {
    "rtl": true,
    "ltr": false
  }
}
```

Base CSS should include RTL overrides using `[dir="rtl"]` selectors or CSS logical properties.

### 3. Admin Interface
- Admin should default to Hebrew
- All form labels, buttons, navigation should be translatable
- For MVP: Hardcode Hebrew labels first (we can make it properly i18n later)
- Keep English as a secondary option

### 4. Content Direction
- Each page can have a `direction` field (`rtl` or `ltr`)
- Blocks should inherit the page direction
- Rich text / content areas must handle mixed content gracefully (Hebrew + numbers + English)

### 5. Fonts
- Good Hebrew font stack is required (e.g. "Noto Sans Hebrew", "Assistant", system fonts)
- Themes should include proper Hebrew typography defaults

## CLI / Programmatic Considerations

When building content via CLI or agents:
- The system should make it easy to set `direction: "rtl"`
- Slugs should support Hebrew (or we decide on transliteration strategy)
- Text content should be stored as normal UTF-8 (no special escaping needed)

## Testing
We need to test:
- Mobile + desktop RTL
- Mixed LTR/RTL content (English words inside Hebrew sentences)
- Forms in admin
- Theme components

---
This document will evolve as we build.
