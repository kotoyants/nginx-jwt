# nginx-jwt

Get token: \
`TOKEN=$(curl -s -X POST http://localhost:8000/login -H 'Content-Type: application/json' -d '{"login":"admin","password":"admin123"}' | jq -r .token)`

Use token: \
`curl -H "Authorization: Bearer $TOKEN" http://localhost:8000/profile`
