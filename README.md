# oryu-online-office

앱스크립트 기반 오류초 온라인 교무실입니다.

웹앱 주소: https://script.google.com/macros/s/AKfycbwhlNdVDSsMu34QasylaGvoaslxZSf4KX2yY6qnYqyjGEEtWuGorlnjtXSLK3Swte669A/exec

## 배포 방식

`main` 브랜치에 변경이 반영되면 `.github/workflows/deploy.yml`이 자동으로 실행됩니다.

1. `clasp push`로 `.gs`, `.html`, `appsscript.json` 파일을 Apps Script 프로젝트에 올립니다.
2. `clasp deploy -i <기존 배포 ID>`로 **기존 배포를 새 버전으로 갱신**합니다. 새 배포를 만들지 않으므로 웹앱 주소가 바뀌지 않습니다.
3. 버전 설명에는 `CHANGELOG.md` 맨 위 항목 제목이 들어갑니다.

Actions 탭에서 "Apps Script 배포"를 골라 **Run workflow**로 수동 실행할 수도 있습니다.

필요한 GitHub Secret:

- `CLASPRC_JSON`: clasp 로그인 후 생성되는 `~/.clasprc.json` 파일 내용 전체
- `SCRIPT_ID`: Apps Script 프로젝트 설정의 스크립트 ID

## 수정 규칙

- 모든 수정은 `CHANGELOG.md` 맨 위에 날짜와 제목, 변경 내용을 한국어로 적습니다.
- 웹앱은 항상 기존 배포의 새 버전으로만 배포합니다. 새 배포를 만들지 않습니다.
