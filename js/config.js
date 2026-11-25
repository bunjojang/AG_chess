// 온라인 대전을 켜려면 Firebase 콘솔 > 프로젝트 설정 > 내 앱(웹 앱)에서 복사한 값을 아래에 붙여 넣으세요.
// 자세한 순서는 README.md의 "온라인 대전 켜기"에 있습니다.
// 이 값들은 공개되어도 괜찮습니다. 누가 무엇을 쓸 수 있는지는 database.rules.json의 보안 규칙이 정합니다.
// null이면 온라인 대전 버튼이 꺼지고 한 화면 모드만 동작합니다.

export const firebaseConfig = null;

/* 예시 (값은 본인 프로젝트 것으로):
export const firebaseConfig = {
  apiKey: "AIza...",
  authDomain: "my-augchess.firebaseapp.com",
  databaseURL: "https://my-augchess-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "my-augchess",
  appId: "1:1234567890:web:abcdef"
};
*/
