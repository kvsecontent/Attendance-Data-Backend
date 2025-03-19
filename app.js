// app.js - Backend for Exam Results Portal
const express = require('express');
const cors = require('cors');
const axios = require('axios');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(cors());

// Environment variables for sensitive data
const SHEET_ID = process.env.SHEET_ID;
const API_KEY = process.env.API_KEY;

// API endpoint to fetch student data
app.get('/api/student/:rollNumber', async (req, res) => {
  try {
    const { rollNumber } = req.params;
    
    // Fetch data from Google Sheets API
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/Sheet1?key=${API_KEY}`;
    const response = await axios.get(url);
    const data = response.data;
    
    // Process the data to find the student
    const rows = data.values;
    const headers = rows[0]; // First row contains headers
    
    // Find the indexes of important columns
    const rollIndex = headers.indexOf('Roll_Number');
    const nameIndex = headers.indexOf('Name');
    const classIndex = headers.indexOf('Class');
    const schoolIndex = headers.indexOf('School');
    const examInchargeSignatureIndex = headers.indexOf('ExamInchargeSignature');
    const totalMarksIndex = headers.indexOf('Total_Marks');
    const totalObtainedIndex = headers.indexOf('Total_Obtained');
    const percentageIndex = headers.indexOf('Percentage');
    const cgpaIndex = headers.indexOf('CGPA');
    const resultIndex = headers.indexOf('Result');
    const examNameIndex = headers.indexOf('Exam_Name');
    const dobIndex = headers.indexOf('DOB');
    const fatherNameIndex = headers.indexOf('Father_Name');
    const motherNameIndex = headers.indexOf('Mother_Name');
    
    // Find subject columns (they should be between Class and Total_Marks)
    const subjectColumns = [];
    for (let i = classIndex + 1; i < totalMarksIndex; i++) {
      if (headers[i] && !headers[i].includes('_Grade') && !headers[i].includes('_Max')) {
        // Check if there's a corresponding grade column
        const gradeColumnName = `${headers[i]}_Grade`;
        const gradeIndex = headers.indexOf(gradeColumnName);
        
        // Check if there's a corresponding max marks column
        const maxMarksColumnName = `${headers[i]}_Max`;
        const maxMarksIndex = headers.indexOf(maxMarksColumnName);
        
        subjectColumns.push({ 
          index: i, 
          name: headers[i],
          gradeIndex: gradeIndex !== -1 ? gradeIndex : -1,
          maxMarksIndex: maxMarksIndex !== -1 ? maxMarksIndex : -1
        });
      }
    }
    
    // Look for the student with matching roll number
    let studentData = null;
    for (let i = 1; i < rows.length; i++) {
      if (rows[i][rollIndex] === rollNumber) {
        // Found the student, now format the data
        studentData = {
          name: rows[i][nameIndex],
          class: rows[i][classIndex],
          school: schoolIndex !== -1 ? rows[i][schoolIndex] : 'PM SHRI KENDRIYA VIDYALAYA RAEBARELI',
          examInchargeSignature: examInchargeSignatureIndex !== -1 ? rows[i][examInchargeSignatureIndex] : 'Exam Incharge.png',
          totalMarks: parseInt(rows[i][totalMarksIndex]),
          totalObtained: parseInt(rows[i][totalObtainedIndex]),
          percentage: parseFloat(rows[i][percentageIndex]),
          cgpa: rows[i][cgpaIndex], // Keep as string to allow text remarks
          result: rows[i][resultIndex],
          examName: examNameIndex !== -1 && rows[i][examNameIndex] ? rows[i][examNameIndex] : 'Final Term',
          dob: dobIndex !== -1 ? rows[i][dobIndex] : 'Not Available',
          fatherName: fatherNameIndex !== -1 ? rows[i][fatherNameIndex] : 'Not Available',
          motherName: motherNameIndex !== -1 ? rows[i][motherNameIndex] : 'Not Available',
          subjects: []
        };
        
        // Process subject marks
        subjectColumns.forEach(subject => {
          const marks = parseInt(rows[i][subject.index]);
          let grade;
          let maxMarks = 100; // Default max marks
          
          // Get grade from Google Sheets if available
          if (subject.gradeIndex !== -1 && rows[i][subject.gradeIndex]) {
            grade = rows[i][subject.gradeIndex];
          } else {
            // Fallback to calculating grade
            grade = calculateGrade(marks);
          }
          
          // Get max marks from Google Sheets if available
          if (subject.maxMarksIndex !== -1 && rows[i][subject.maxMarksIndex]) {
            maxMarks = parseInt(rows[i][subject.maxMarksIndex]);
          }
          
          studentData.subjects.push({
            name: subject.name,
            maxMarks: maxMarks,
            obtained: marks,
            grade: grade
          });
        });
        
        break;
      }
    }
    
    if (studentData) {
      return res.json({ success: true, data: studentData });
    } else {
      return res.status(404).json({ success: false, message: 'Student not found' });
    }
  } catch (error) {
    console.error('Error fetching data:', error);
    return res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
});

// Helper function to calculate grade
function calculateGrade(marks) {
  if (marks >= 90) return 'A';
  else if (marks >= 80) return 'B';
  else if (marks >= 70) return 'C';
  else if (marks >= 60) return 'D';
  else if (marks >= 50) return 'E';
  else return 'F';
}

app.get('/', (req, res) => {
  res.send('Exam Results Portal API is running');
});

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});

module.exports = app; // For testing purposes
