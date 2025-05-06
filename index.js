const express = require('express');
const mysql = require('mysql2');

// create connection
const connection = mysql.createConnection({
  host     : 'localhost',
  user     : 'root',
  password : '32662272',
  database : 'child_sponsor_connect1'
});

// connect
connection.connect((error) => {
  if (error) {
    throw error;
  }
  console.log('MySQL connected...');
});

const app = express();

// create database
app.get('/createdb', (req, res) => {
    let sql = 'CREATE DATABASE IF NOT EXISTS child_sponsor_connect1';  // Note: IF NOT EXISTS
    connection.query(sql, (err, result) => {
      if (err) {
        console.error(err.message);
        return res.status(500).send('Error: ' + err.message);
      }
      res.send('Database created or already exists');
    });
  });
//   add sponsor
app.post('/sponsors', (req, res) => {
    const { name, email, description } = req.body;
    const sql = 'INSERT INTO sponsors (name, email, description) VALUES (?, ?, ?)';
    connection.query(sql, [name, email, description], (err, result) => {
      if (err) return res.status(500).send('Error: ' + err.message);
      res.send({ message: 'Sponsor added', sponsorId: result.insertId });
    });
  });
//   create sponsors
app.get('/create-sponsors-table', (req, res) => {
    let sql = `
      CREATE TABLE IF NOT EXISTS sponsors (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(255),
        email VARCHAR(255),
        description TEXT
      )
    `;
    connection.query(sql, (err, result) => {
      if (err) throw err;
      console.log(result);
      res.send('Sponsors table created');
    });
  });
  
  app.post('/sponsors', (req, res) => {
    const { name, email, description } = req.body;
    const sql = 'INSERT INTO sponsors (name, email, description) VALUES (?, ?, ?)';
    connection.query(sql, [name, email, description], (err, result) => {
      if (err) return res.status(500).send('Error: ' + err.message);
      res.send({ message: 'Sponsor added', sponsorId: result.insertId });
    });
  });
  
// create family_members table
app.get('/family-members', (req, res) => {
    let sql = `
      CREATE TABLE IF NOT EXISTS family_members (
        id INT AUTO_INCREMENT PRIMARY KEY,
        sponsor_id INT,
        name VARCHAR(255),
        email VARCHAR(255),
        date_of_birth DATE,
        FOREIGN KEY (sponsor_id) REFERENCES sponsors(id) ON DELETE CASCADE
      )
    `;
    connection.query(sql, (err, result) => {
      if (err) throw err;
      console.log(result);
      res.send('Family members table created');
    });
  });
  
  app.post('/family-members', (req, res) => {
    const { sponsor_id, name, email, date_of_birth } = req.body;
    const sql = 'INSERT INTO family_members (sponsor_id, name, email, date_of_birth) VALUES (?, ?, ?, ?)';
    connection.query(sql, [sponsor_id, name, email, date_of_birth], (err, result) => {
      if (err) return res.status(500).send('Error: ' + err.message);
      res.send({ message: 'Family member added', memberId: result.insertId });
    });
  });
  

app.listen(8000, () => console.log('Server running on port 8000'));
