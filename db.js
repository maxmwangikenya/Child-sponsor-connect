// db.js
require('dotenv').config();
const mysql = require('mysql2/promise');

const dbUri = process.env.dbURI

const pool = mysql.createPool(dbUri);

module.exports = pool;
