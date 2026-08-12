# 카자흐스탄 팝업 매대 배정 도구

출고 리스트(1,858개 SKU)를 검색·필터링하고, 1~6번 매대에 배정해서
팀원 여러 명이 동시에 실시간으로 보고 수정할 수 있는 웹 도구예요.

## 구성

```
index.html          메인 페이지
style.css            스타일
app.js                로직 (검색/필터/매대 배정/실시간 동기화)
config.js             Supabase 접속 정보 (직접 채워야 함)
data/products.json    제품 목록 (정적 데이터, 1,858개)
supabase-schema.sql    Supabase에 실행할 테이블 생성 SQL
```

## 1. Supabase 프로젝트 만들기 (5분)

1. https://supabase.com → 구글/깃허브 계정으로 가입 → **New project**
2. 이름/비밀번호 아무거나 입력하고 생성 (1~2분 소요)
3. 왼쪽 메뉴 **SQL Editor** → `supabase-schema.sql` 파일 내용 전체 복사해서 붙여넣고 **Run**
4. 왼쪽 메뉴 **Project Settings → API** 에서 아래 두 값 복사:
   - **Project URL** → `https://xxxxx.supabase.co`
   - **anon public** key → `eyJhbGc...` 로 시작하는 긴 문자열

## 2. config.js 채우기

`config.js` 파일을 열어서 방금 복사한 값 두 개를 넣어주세요.

```js
const SUPABASE_URL = "https://xxxxx.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGc.....";
```

## 3. GitHub Pages로 배포하기

1. GitHub에 새 저장소 생성 (예: `kaz-popup-shelf`)
2. 이 폴더 안의 파일들을 그대로 업로드 (또는 `git push`)
3. 저장소 **Settings → Pages** → Source를 `main` 브랜치 `/ (root)`로 설정 → Save
4. 1~2분 뒤 `https://[내깃허브아이디].github.io/kaz-popup-shelf/` 로 접속 가능

이 링크를 팀원들에게 공유하면 다들 같은 화면에서 실시간으로
매대 배정 상태를 보고 바꿀 수 있어요.

## 사용법

- 상단 검색창: 제품명 / 제품코드 / 바코드로 검색
- 대분류 → 중분류 → 소분류 → 세부분류 순서로 좁혀가며 필터링 가능
- 상단의 매대 칩(미배정~6번)을 클릭하면 해당 매대만 필터링
- 각 제품 행의 숫자 버튼(1~6)을 클릭하면 그 매대로 배정, 배정된 버튼을 다시 클릭하면 해제
- 배정되면 행 전체가 매대별 색으로 물들고 제품명도 같은 색으로 표시됨
- 우측 "최근 변경" 패널에서 누가 무엇을 언제 바꿨는지 실시간으로 확인 가능
- 우측 상단 "작업자" 칸에 이름을 입력해두면 변경 기록에 이름이 남음

## 참고 / 한계

- 로그인 기능은 없어요. 링크와 anon key만 있으면 누구나 접속·수정할 수 있는
  "내부 공유 링크" 방식이에요. 필요하면 나중에 Supabase Auth로 로그인을 추가할 수 있어요.
- `data/products.json`은 정적 파일이라, 출고 리스트 자체가 바뀌면
  (신규 SKU 추가 등) 이 파일을 다시 만들어서 교체해야 해요.
- 매대는 현재 1~6번까지만 지원해요. 더 늘리려면 `app.js` 상단의
  `SHELF_COUNT` 값과 `style.css`의 `--shelf-*` 색상을 추가해주면 돼요.
