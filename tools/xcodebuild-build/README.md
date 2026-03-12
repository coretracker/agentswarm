curl -N http://host.docker.internal:8080/xcodebuild \
  -X POST \
  -H "Content-Type: application/json" \
  -d '{
    "repoPath": "/Users/andreasehrlich-gruber/Documents/Repositories/stepsapp-iOS",
    "branch": "feature/issue-3735-reacting-to-a-message-in-a-ch-hapfVPIU",
    "subdir": "",
    "args": [
       "-scheme","stepapp",
      "-project","stepapp.xcodeproj",
      "-destination","platform=iOS Simulator,name=iPhone 17 Pro,OS=26.0",
      "build"
    ]
  }'

  curl -N http://localhost:8080/xcodebuild \
  -X POST \
  -H "Content-Type: application/json" \
  -d '{
    "repoPath": "/Users/andreasehrlich-gruber/Documents/Repositories/stepsapp-iOS",
    "branch": "feature/issue-3735-reacting-to-a-message-in-a-ch-hapfVPIU",
    "subdir": "",
    "args": [
       "-scheme","stepapp",
      "-project","stepapp.xcodeproj",
      "-destination","platform=iOS Simulator,name=iPhone 17 Pro,OS=26.0",
      "build"
    ]
  }'