# UI Restructure: Settings + Single Main View

## Problem
- File key / access token 설정이 Export 탭에 섞여있어 혼잡
- Export/Import가 별도 탭이라 브랜치→메인 워크플로우가 끊김

## Design

### Settings Page (gear icon)
- File Key 입력 (paste URL → auto-extract)
- Figma Access Token (password input, show/hide toggle, remember checkbox)
- Back button to return to main

### Main Page
- Header: "Comment Bridge" + gear icon (top-right)
- **Export section**: Include resolved checkbox, Export button, status, download button
- Divider
- **Import section**: Load saved export button, file upload, JSON paste, Import button, status

### Behavior
- Export 클릭 시 file key 또는 token 미설정이면 설정 페이지로 안내
- 설정은 clientStorage에 저장 (token) + pluginData에 저장 (file key)
- 페이지 전환은 CSS display toggle (SPA 방식)

## Files to modify
- `src/ui.html` - HTML/CSS/JS 전면 리팩토링
- `src/code.ts` - 변경 없음 (기존 메시지 프로토콜 유지)
- `src/types.ts` - 변경 없음
