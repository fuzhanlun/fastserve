'use strict';

const https = require('https');
const http = require('http');
const url = require('url');
const fs = require('fs');
const qs = require('querystring');
const crypto = require('crypto');
//mime类型对照表
const mime = {
	'html': 'text/html',
	'txt' : 'text/plain',
	'css' : 'text/css',
	'js'  : 'application/javascript',
	'ico' : 'image/x-icon',
	'png' : 'image/png',
	'jpeg': 'image/jpeg',
	'jpg' : 'image/jpeg',
	'gif' : 'image/gif'
};

var getMap  = {}; //get请求映射
var postMap = {}; //post请求映射
var tplCache = {}; //模板缓存

//默认设置
var config = {
	'charset': 'utf-8', //静态页面编码
	'cache' : true, //模板编译缓存
	'encode': 'utf8', //默认输出编码
	'err404': 'Not Found\n', //错误提示
	'expire': 1800000, //session过期时间
	'maxage': 86400, //静态页面缓存时间
	'static': './static', //静态文件目录地址
	'https' : false //https 设置为true
};

//定义页面不存在方法句柄
function notFound(req, res) {
	let msg = config.err404;

	res.writeHead(404, {
		'Content-Type': 'text/plain',
		'Content-Length': msg.length
	});
	res.end(msg);
}

//截取文件扩展名
function extName(fname) {
	let i = fname.lastIndexOf('.');
	return i < 0 ? '' : fname.substring(i + 1);
}

//定义内存数据库类
class MemoryDB {
	constructor(db, sorts) {
		this.change = 0; //更新标记
		this.data = (typeof db == 'object')? db : {};

		//设置数据库默认值
		if (typeof this.data.auid == 'undefined') this.data.auid = 1;
		if (typeof this.data.hash == 'undefined') this.data.hash = {};
		if (typeof this.data.sort == 'undefined') this.data.sort = {};

		//定义快捷引用
		this.hash = this.data.hash;
		this.sort = this.data.sort;
		
		if (typeof sorts == 'object') {
			//检查并更新排序列
			sorts.map(v => {
				if (!this.sort[v] || this.sort[v].length == 0) {
					this.sort[v] = this.createSort(v);
					this.change ++;
				}
			});
		}
	}

	//创建排序列
	createSort(key, where) {
		let arr = [];
		let res = [];
		let val = null;

		//遍历对象
		if (typeof where == 'function') {
			for (let k in this.hash) {
				val = this.hash[k];
				if (where(val)) arr.push({'k': k, 'v': val[key]});
			}
		} else {
			for (let k in this.hash) {
				val = this.hash[k];
				arr.push({'k': k, 'v': val[key]});
			}
		}
		//进行升序排序
		arr.sort((a, b) => {
			return a.v - b.v;
		});
		//保留索引数组
		let len = arr.length;
		for (let i = 0; i < len; i++) {
			res.push(arr[i].k); //生成序列数组
		}
		arr = null;
		return res;
	}

	//更新排序
	updateSort(obj) {
		if (typeof obj == 'object') {
			for (let k in obj) { //排序指定键值
				if (this.sort[k]) this.sort[k] = this.createSort(k);
			}
		} else { //排序全部键值
			for (let k in this.sort) {
				this.sort[k] = this.createSort(k);
			}
		}
		return true;
	}

	//通过key查询
	findByKey(key) {
		return this.hash[key] || null;
	}

	//查询一条数据
	findOne(where) {
		let res = null;

		//遍历对象
		for (let k in this.hash) {
			res = this.hash[k];
			if (where(res)) return res;
		}
		return null;
	}

	//查询多条数据
	findAll(obj = {}) {
		let arr = [];
		let rec = null;
		let num = 0;
		let order = obj.order || '';
		let limit = [1, Object.keys(this.hash).length];
		let where = obj.where || function(){return true};

		if (obj.limit) {
			if (typeof obj.limit[0] == 'number') limit[0] = obj.limit[0];
			if (typeof obj.limit[1] == 'number') limit[1] = obj.limit[1];
			if (limit[1] == 0) limit[1] = -Object.keys(this.hash).length; //0 为降序排列
		}
		limit[0]--; //修正初始值
		if (limit[1] > 0) { //升序排列
			let end = limit[0] + limit[1] + 1;
			let sort = order? this.sort[order]: Object.keys(this.hash);

			if (typeof sort == 'object') { //使用已存在的序列查找
				let len = sort.length;
				for (let i = 0, len = sort.length; i < len; i++) {
					rec = this.hash[sort[i]];
					if (where(rec)) {
						num++;
						if (num > limit[0] && num < end) arr.push(rec);
						if (num > end) break;
					}
				}
			} else { //生成新序列继续查找
				sort = this.createSort(order, where);
				for (let i = 0, len = sort.length; i < len; i++) {
					num++;
					rec = this.hash[sort[i]];
					if (num > limit[0] && num < end) arr.push(rec);
					if (num > end) break;
				}
			}
		} else { //降序排列
			let end = limit[0] + limit[1] * -1 + 1;
			let sort = order? this.sort[order]: Object.keys(this.hash);

			if (typeof sort == 'object') { //使用已存在的序列查找
				for (let i = sort.length - 1; i >= 0; i--) {
					rec = this.hash[sort[i]];
					if (where(rec)) {
						num++;
						if (num > limit[0] && num < end) arr.push(rec);
						if (num > end) break;
					}
				}
			} else { //生成新序列继续查找
				sort = this.createSort(order, where);
				for (let i = sort.length - 1; i >= 0; i--) {
					num++;
					rec = this.hash[sort[i]];
					if (num > limit[0] && num < end) arr.push(rec);
					if (num > end) break;
				}
			}
		}

		return arr;
	}

	//获得总条数
	findTotal(where) {
		if (typeof where == 'function') {
			let num = 0;
			for (let k in this.hash) {
				if (where(this.hash[k])) num++;
			}
			return num;
		}

		return Object.keys(this.hash).length;
	}

	//插入一条数据
	insertOne(obj, key) {
		if (typeof key == 'undefined') key = (this.data.auid++).toString();
		if (this.hash[key]) return false; //防止键名重复

		this.hash[key] = obj;
		this.updateSort(obj); //重新生成排序
		this.change ++;
		return key;
	}

	//通过键值修改
	updateByKey(obj, key) {
		let val = this.hash[key];

		if (typeof val == 'undefined') return false;

		//覆盖原内容
		for (let k in obj) val[k] = obj[k];
		//更新排序
		if (this.sort[key]) this.sort[key] = this.createSort(key);
		this.change ++;
		return true;
	}

	//通过条件修改
	updateOne(obj, where) {
		let val = null;

		for (let key in this.hash) {
			val = this.hash[key];
			if (where(val)) {
				for (let k in obj) {
					val[k] = obj[k]; //覆盖原内容
					if (this.sort[k]) this.sort[k] = this.createSort(k); //更新排序
				}
				this.change ++;
				return true;
			}
		}
		return false;
	}

	//通过条件修改
	updateAll(obj, where) {
		let val = null;
		let num = 0;

		for (let key in this.hash) {
			val = this.hash[key];
			if (where(val)) {
				for (let k in obj) val[k] = obj[k]; //覆盖原内容
				num ++; //记录更新个数
			}
		}

		if (num) {
			this.updateSort(obj); //重新生成排序
			this.change ++;
		}

		return num;
	}

	//删除一条数据
	delByKey(key) {
		if (typeof this.hash[key] == 'undefined') return false;
		delete this.hash[key];
		this.updateSort(); //重新生成排序
		this.change ++;
		return true;
	}
}

//定义Json数据库类
class JsonDB extends MemoryDB {
	constructor(fname, sorts) {
		let data = {};
		try {
			fs.accessSync(fname, fs.constants.R_OK | fs.constants.W_OK); //测试读写
			data = JSON.parse(fs.readFileSync(fname, 'utf8')); //读取并解析文件
		} catch (err) {
			if (err.code == 'ENOENT') fs.writeFileSync(fname, '{}', 'utf8'); //不存在则创建
			else console.log(err);
		}
		super(data, sorts);
		this.fname = fname;
	}

	//保存文件
	store(cb) {
		if (typeof cb == 'function') {
			//异步更新并保存文件
			return fs.writeFile(this.fname, JSON.stringify(this.data), 'utf8', cb);
		} else {
			//同步更新并保存文件
			return fs.writeFileSync(this.fname, JSON.stringify(this.data), 'utf8');
		}
	}
}
exports.JsonDB = JsonDB;

//数据定时存储
exports.JsonDBStore = function() {
	let arg = arguments;
	let len = arg.length;
	let sec = arg[0];

	if (len < 2) return;

	setInterval(function() {
		for (let i = 1; i < len; i++) {
			if (arg[i]['change'] > 0) {
				arg[i].store(); //保存文件
				arg[i]['change'] = 0; //重置归零
			}
		}
	}, sec);
};

//扩展ServerResponse原型 输出html数据
http.ServerResponse.prototype.html = function(data) {
	if (typeof data == 'number') data = data.toString();
	
	this.writeHead(200, {
		'Content-Type': 'text/html; charset=' + config.charset,
		'Content-Length': Buffer.byteLength(data, config.encode)
	});

	this.end(data, config.encode);
};

//扩展ServerResponse原型 重定向
http.ServerResponse.prototype.redirect = function(url, code = 302) {
	this.writeHead(code, {'Location': url});
	this.end();
};

//扩展ServerResponse原型 输出cookie
http.ServerResponse.prototype.setCookie = function(name, value) {
	this.setHeader('Set-Cookie', name + '=' + value + '; Path=/');
};

//扩展IncomingMessage原型 获取GET请求值
http.IncomingMessage.prototype.getQuery = function(key) {
	return this.query[key] || '';
};

//扩展IncomingMessage原型 获取POST请求值
http.IncomingMessage.prototype.getBody = function(key) {
	return this.body[key] || '';
};

//扩展IncomingMessage原型 获取Cookie值
http.IncomingMessage.prototype.getCookie = function(name) {
	let regex = new RegExp('(^|;)\\s*'+name+'=([^;]*)').exec(this.headers['cookie']);
	let match = (regex && regex[2]);
	return (match && decodeURIComponent(match));
};

//扩展IncomingMessage原型 session功能
var session = new MemoryDB();
http.IncomingMessage.prototype.session = function() {
	const SESSIONID = '_sid';
	let arg = arguments;
	let len = arg.length;
	let sid = this.getCookie(SESSIONID);

	if (len == 0) { //删除session
		return session.delByKey(sid);
	}

	if (len == 1) { //读取session
		let data = null;
		let msec = new Date().getTime();
		let rand = parseInt(Math.random()*10); //0-9随机数

		if (rand == 1) { //随机触发过期检测任务0.1
			let v = null;
			for (let k in session.hash) {
				v = session.hash[k];
				if (msec - v['_expire'] > config.expire) {
					session.delByKey(k);
				}
			}
		}

		data = session.findByKey(sid);
		if (data) {
			if (msec - data['_expire'] < config.expire) {
				return data[arg[0]];
			} else { //session 过期删除
				session.delByKey(sid);
			}
		}
		return null;
	}

	if (len == 2) { //更改session
		let data = session.findByKey(sid);
		let msec = new Date().getTime();

		if (sid && data) { //直接修改
			data[arg[0]] = arg[1];
			data['_expire'] = msec;
		} else { //不存在则创建session
			data = {'_expire': msec};
			data[arg[0]] = arg[1];
			sid = crypto.createHash('sha1').update(msec.toString()).digest('hex');
			session.insertOne(data, sid);
			this.response.setCookie(SESSIONID, sid);
		}
		return true;
	}
};

//扩展ServerResponse原型 渲染模板并输出
http.ServerResponse.prototype.render = function(fname, value) {
	let tpl = '';

	if (config.cache && tplCache[fname]) {
		//从缓存的模板渲染
		tpl = tplCache[fname];
		//一次编译
		// tpl = tpl.replace(/{{(.+?)}}/g, (a, b) => {
		// 	return (new Function('data', 'return ' + b))(value);
		// });
		//二次编译
		this.html((new Function('data', 'return `' + tpl + '`'))(value));
	} else {
		//读取模板文件
		fs.readFile(fname, 'utf8', (err, data) => {
			if (err) {
				this.html(fname + ' Read Error');
			} else {
				//合成模板
				tpl = data.replace(/{{include (\S+)}}/ig, (a, b) => {
					try {
						return fs.readFileSync(b);
					}catch(e) {
						return b + ' Read Error';
					}
				});

				//编译模板
				// tpl = tpl.replace(/[\t\n\r]/g, '');
				if (config.cache) tplCache[fname] = tpl; //缓存模板
				//一次编译
				// tpl = tpl.replace(/{{(.+?)}}/g, (a, b) => {
				// 	return (new Function('data', 'return ' + b))(value);
				// });
				//二次编译
				this.html((new Function('data', 'return `' + tpl + '`'))(value));
			}
		});
	}
};

//静态文件服务句柄函数
function staticFile(req, res, fname) {
	fs.stat(fname, (err, stats) => {
		if (err) return notFound(req, res);
		let mtime = stats.mtime.toUTCString();
		if (req.headers['if-modified-since'] == mtime) { //内容没有修改
			res.writeHead(304, {
				'Last-Modified': mtime,
				'Cache-Control': 'max-age=' + config.maxage
			});
			res.end();
		} else { //内容有修改
			let type = mime[extName(fname).toLowerCase()] || 'application/octet-stream';
			fs.readFile(fname, 'binary', (err, data) => {
				if (err) return notFound(req, res);
				res.writeHead(200, {
					'Content-Type': type,
					'Content-Length': data.length,
					'Last-Modified': mtime,
					'Cache-Control': 'max-age=' + config.maxage
				});
				res.end(data, 'binary');
			});
		}
	});
}

//创建http 或 https服务
exports.createServer = (options) => {
	let httpx = config.https? https: http;

	let server = httpx.createServer(options, (req, res) => {
		let urlparse = url.parse(req.url);
		let pathname = urlparse.pathname;
		let handler = null;
	
		req.response = res;
		if (req.method == 'GET') {
			//处理get请求
			handler = getMap[pathname];
			if (typeof handler == 'function') {
				req.query = qs.parse(urlparse.query);
				if (handler(req, res) != true) return;
			}
			//针对静态目录特殊处理 输出静态文件
			if (pathname.charAt(pathname.length-1) == '/') pathname += 'index.html';
			staticFile(req, res, config.static + pathname);
		} else if (req.method == 'POST') {
			//处理post请求
			let data = '';
			handler = postMap[pathname] || notFound;
	
			req.on('data', (chunk) => {
				data += chunk;
			});
			req.on('end', () => {
				req.query = qs.parse(urlparse.query);
				req.body  = qs.parse(data);
				handler(req, res);
			});
		}
	});
	return exports.server = server;
};

exports.get = (path, handler) => {
	getMap[path] = handler;
};

exports.post = (path, handler) => {
	postMap[path] = handler;
};

exports.config = config;