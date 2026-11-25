# 처음부터 설정하기

지금 저장소는 이미 설정이 끝나 있습니다. 이 문서는 다른 계정으로 옮기거나 저장소를 복제해서 새로 운영할 때만 필요합니다.

## 1. GitHub Pages로 올리기

1. 저장소 **Settings → Pages**로 갑니다.
2. **Build and deployment → Source**를 `Deploy from a branch`로 두고, Branch를 `main` / `/(root)`로 고른 뒤 **Save**를 누릅니다.
3. 1~2분 뒤 `https://<GitHub 아이디>.github.io/<저장소 이름>/` 에서 열립니다.

이 상태로도 한 화면 2인은 바로 할 수 있습니다.

## 2. 온라인 대전 켜기 (Firebase, 약 5분)

1. https://console.firebase.google.com 에서 **프로젝트 추가**를 누릅니다. Google 애널리틱스는 꺼도 됩니다.
2. 왼쪽 메뉴 **빌드 → Authentication → 시작하기 → 로그인 방법** 탭에서 **익명**을 사용 설정합니다.
3. **빌드 → Realtime Database → 데이터베이스 만들기**를 누릅니다. 위치는 `싱가포르(asia-southeast1)`가 한국에서 가장 가깝고, **잠금 모드로 시작**을 고릅니다.
4. Realtime Database의 **규칙** 탭을 열고, 이 저장소의 `database.rules.json` 내용을 그대로 붙여 넣은 뒤 **게시**합니다.
5. 톱니바퀴 **프로젝트 설정 → 일반 → 내 앱**에서 웹 아이콘(`</>`)을 눌러 앱을 등록합니다. 호스팅은 체크하지 않아도 됩니다.
6. 화면에 나오는 `firebaseConfig = { ... }` 값을 복사해서 `js/config.js`의 `export const firebaseConfig = null;`을 바꿉니다.
   ```js
   export const firebaseConfig = {
     apiKey: "...",
     authDomain: "...",
     databaseURL: "https://...firebasedatabase.app",
     projectId: "...",
     appId: "..."
   };
   ```
   `databaseURL`이 빠져 있으면 Realtime Database 화면 맨 위에 보이는 주소(`https://...firebasedatabase.app`)를 직접 넣어 주세요.
7. **Authentication → 설정 → 승인된 도메인**에 `<GitHub 아이디>.github.io`를 추가합니다.
8. `js/config.js`를 커밋해서 올리면 끝입니다. 페이지의 "온라인 대전" 칸에 방 만들기 버튼이 나타납니다.

`firebaseConfig` 값은 공개 저장소에 올라가도 괜찮습니다. 웹 앱용 식별자일 뿐이고, 누가 무엇을 쓸 수 있는지는 4단계의 보안 규칙이 정합니다.
