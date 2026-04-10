docker-compose up --build
npm run dev


curl -X POST http://localhost:8000/artworks \
  -H "Content-Type: application/json" \
  -d '{"image_url": "https://picsum.photos/200", "prompt": "test artwork"}'
