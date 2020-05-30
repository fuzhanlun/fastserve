'use strict';

const FastServe = require('./fastserve');

//设置服务器参数
FastServe.config.cache  = false; //取消模板缓存
FastServe.config.maxage = 0; //取消静态文件缓存

FastServe.createServer().listen(80);