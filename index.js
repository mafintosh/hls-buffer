var stream = require('stream-wrapper');
var ForeverAgent = require('forever-agent');
var request = require('request');
var once = require('once');
var crypto = require('crypto');
var thunky = require('thunky');
var resolveUrl = require('url').resolve;

var noop = function() {};

var md5 = function(str) {
	return crypto.createHash('md5').update(str).digest('hex');
};

module.exports = function(url, opts) {
	if (!opts) opts = {};

	var queued = [];
	var that = {};
	var max = opts.max || 6; // default max ~6 in queue
	var onplaylist;

	var agent = undefined;

	if (opts.agent !== false) agent = /^https/.test(url) ? new ForeverAgent.SSL() : new ForeverAgent();

	var readPlaylist = function(playlistUrl, callback) {
		var ts = [];
		request(playlistUrl, {agent:agent}, function(err, response) {
			if (response.statusCode !== 200) return callback();

			var body = response.body.toString().trim();

			body = body.split('\n').map(function(line) {
				if (line[0] === '#') return line;
				var url = resolveUrl(playlistUrl, line);
				var id = '/'+md5(line)+'.ts';
				ts.push({url:url, id:id});
				return id;
			}).join('\n')+'\n';

			callback(null, ts, body);
		});
	};

	var preload = function() {
		if (that.destroyed) return;

		var fetching = queued.some(function(q) {
			return q.source && !q.finished;
		});

		if (fetching) return;

		fetching = queued.some(function(q, i) {
			if (q.finished || q.source) return;
			if (i > max) return true;

			var req = request(q.url, {agent:agent});
			var onclose = once(function() {
				q.finished = true;
				q.streams.forEach(function(s) {
					s.push(null);
				});
				preload();
			});

			req.on('data', function(buf) {
				q.buffers.push(buf);
				q.streams.forEach(function(s) {
					s.push(buf);
				});
			});
			req.on('end', onclose);
			req.on('close', onclose);

			q.source = req;

			return true;
		});

		if (fetching) return;
		if (queued.length >= max) return;

		that.playlist(); // refetch the playlist so we can preload some more stuff...
	};

	that.destroyed = false;
	that.playlist = function(callback) {
		if (!callback) callback = noop;
		if (onplaylist) return onplaylist(callback);

		onplaylist = thunky(function(callback) {
			var retries = 0;
			var retry = function() {
				if (that.destroyed) return callback(new Error('destroyed'));

				readPlaylist(url, function(err, ts, playlist) {
					if (!ts) return callback(new Error('could not fetch playlist'));

					if (err && retries < 5) {
						retries++;
						return setTimeout(retry, 5000);
					}

					if (err) return callback(err); // retry instead

					ts.forEach(function(item) {
						var exists = queued.some(function(q) {
							return q.url === item.url;
						});

						item.buffers = [];
						item.streams = [];

						if (!exists) queued.push(item);
					});

					preload();
					callback(null, playlist);

					process.nextTick(function() { // maybe wait a bit longer to bust the old playlist?
						onplaylist = null;
					});
				});
			};
			retry();
		});

		onplaylist(callback);
	};

	that.segment = function(hex) {
		if (that.destroyed) return null;

		// gc
		while (queued.length) {
			var q = queued[0];
			if (q.id === hex) break;
			queued.shift();
			if (q.source && !q.finished) q.source.destroy();
		}

		if (!queued[0]) return null;

		var rs = stream.readable();
		var q = queued[0];

		q.streams.push(rs);
		q.buffers.forEach(function(b) {
			rs.push(b);
		});

		if (q.finished) rs.push(null);

		rs.on('close', function() {
			q.streams.splice(q.streams.indexOf(rs), 1);
		});

		return rs;
	};

	that.destroy = function() {
		that.destroyed = true;
		queued.forEach(function(q) {
			if (q.source && !q.finished) q.source.destroy();
		});
		queued = [];
	};

	return that;
};