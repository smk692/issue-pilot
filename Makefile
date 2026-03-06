.PHONY: run stop build install clean

# 빌드 + 실행 (localhost:3001)
run: stop build
	@echo "Issue Pilot → http://localhost:3001"
	npm start

# 기존 프로세스 종료
stop:
	@lsof -ti :3001 | xargs kill -9 2>/dev/null || true

# 빌드
build:
	npm run build

# 의존성 설치
install:
	npm install

# 빌드 산출물 정리
clean:
	rm -rf dist web/dist
