# hls-buffer

Preload and buffer http live streams (aka do not lag on crappy networks)

	npm install hls-buffer

## Usage

hls-buffer takes a m3u8 url from a remote server and preloads and buffer the linked .ts files

``` js
var hls = require('hls-buffer');
var buffer = hls('http://my-favorite-stream.com/some/path/index.m3u8');
var http = require('http');

var server = http.createServer(function(request, response) {
	if (request.url === '/index.m3u8') {
		// first return a playlist
		buffer.playlist(function(err, pl) {
			response.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
			response.end(pl);
		});
	} else {
		// else return the linked segment
		var stream = buffer.segment(request.url);
		response.setHeader('Content-Type', 'video/mp2s');
		stream.pipe(response);
	}
});

server.listen(8080);
```

If you run the above example with your favorite http live streaming service a local preloading proxy
will be started on `http://localhost:8080/index.m3u8`.

## License

MIT
