// app.js - Deploy to Render backend
const express = require('express');
const cors = require('cors');
const { google } = require('googleapis');
const dotenv = require('dotenv');

// Load environment variables
dotenv.config();

const app = express();
const port = process.env.PORT || 3000;

// API key and Sheet ID from environment variables
const API_KEY = process.env.GOOGLE_API_KEY;
const SHEET_ID = process.env.GOOGLE_SHEET_ID;

app.use(cors({
  origin: '*', // Allow all origins for testing, restrict this in production
  methods: ['GET', 'POST'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

// Health check endpoint
app.get('/', (req, res) => {
  res.json({ status: 'API is running' });
});

// Endpoint to get student data
app.get('/api/student/:rollNumber', async (req, res) => {
  try {
    const sheets = google.sheets({ version: 'v4', auth: API_KEY });
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: 'Students!A:G',
    });
    
    if (!response.data.values || response.data.values.length <= 1) {
      return res.status(404).json({ success: false, message: 'No student data found in the sheet' });
    }
    
    // Assuming first row is header
    const headers = response.data.values[0];
    
    // Find the Roll Number column index
    const rollIndex = headers.findIndex(header => 
      header.toLowerCase().includes('roll') || 
      header.toLowerCase().includes('admission') || 
      header.toLowerCase().includes('id'));
    
    if (rollIndex === -1) {
      return res.status(400).json({ success: false, message: 'Roll Number column not found' });
    }
    
    // Find student by roll number
    const studentRow = response.data.values.find(row => row[rollIndex] === req.params.rollNumber);
    
    if (!studentRow) {
      return res.status(404).json({ success: false, message: 'Student not found' });
    }
    
    // Map student data
    const student = {
      name: studentRow[headers.findIndex(h => h.toLowerCase().includes('name') && !h.toLowerCase().includes('father') && !h.toLowerCase().includes('mother'))] || 'N/A',
      class: studentRow[headers.findIndex(h => h.toLowerCase().includes('class'))] || 'N/A',
      school: 'Kendriya Vidyalaya', // Can be dynamically set if needed
      dob: studentRow[headers.findIndex(h => h.toLowerCase().includes('dob') || h.toLowerCase().includes('birth'))] || 'N/A',
      fatherName: studentRow[headers.findIndex(h => h.toLowerCase().includes('father'))] || 'N/A',
      motherName: studentRow[headers.findIndex(h => h.toLowerCase().includes('mother'))] || 'N/A'
    };
    
    res.json({ success: true, data: student });
  } catch (error) {
    console.error('Error fetching student data:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Endpoint to get attendance data
app.get('/api/student/:rollNumber/attendance', async (req, res) => {
  try {
    const sheets = google.sheets({ version: 'v4', auth: API_KEY });
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: 'Attendance!A:Z',
    });
    
    if (!response.data.values || response.data.values.length <= 1) {
      return res.status(404).json({ success: false, message: 'No attendance data found in the sheet' });
    }
    
    // Assuming first row is header
    const headers = response.data.values[0];
    
    // Find column indexes
    const rollIndex = headers.findIndex(header => 
      header.toLowerCase().includes('roll') || 
      header.toLowerCase().includes('admission') || 
      header.toLowerCase().includes('id'));
    
    const dateIndex = headers.findIndex(h => h.toLowerCase().includes('date'));
    const statusIndex = headers.findIndex(h => h.toLowerCase().includes('status') || h.toLowerCase().includes('present') || h.toLowerCase().includes('absent'));
    const timeIndex = headers.findIndex(h => h.toLowerCase().includes('time') || h.toLowerCase().includes('late'));
    
    if (rollIndex === -1 || dateIndex === -1 || statusIndex === -1) {
      return res.status(400).json({ success: false, message: 'Required attendance data columns not found' });
    }
    
    // Find rows for this student
    const studentAttendanceRows = response.data.values.filter(row => row[rollIndex] === req.params.rollNumber);
    
    if (studentAttendanceRows.length === 0) {
      return res.status(404).json({ success: false, message: 'No attendance records found for this student' });
    }
    
    // Process attendance data by month
    const attendanceByMonth = {};
    let totalSchoolDays = 0;
    let totalPresent = 0;
    
    studentAttendanceRows.forEach(row => {
      const dateStr = row[dateIndex];
      if (!dateStr) return;
      
      // Parse date from format DD/MM/YYYY or MM/DD/YYYY
      let date;
      if (dateStr.includes('/')) {
        const parts = dateStr.split('/');
        if (parts.length === 3) {
          if (parts[0].length <= 2 && parts[1].length <= 2) {
            // Assuming DD/MM/YYYY format
            date = new Date(`${parts[1]}/${parts[0]}/${parts[2]}`);
          } else {
            // Assuming MM/DD/YYYY format
            date = new Date(dateStr);
          }
        }
      } else if (dateStr.includes('-')) {
        date = new Date(dateStr);
      } else {
        return; // Skip if date format is unknown
      }
      
      if (isNaN(date.getTime())) return; // Skip invalid dates
      
      const month = date.getMonth();
      const year = date.getFullYear();
      const day = date.getDate();
      
      // Create month entry if it doesn't exist
      const monthKey = `${month}-${year}`;
      if (!attendanceByMonth[monthKey]) {
        attendanceByMonth[monthKey] = {
          month,
          year,
          totalDays: 0,
          daysPresent: 0,
          daysAbsent: 0,
          percentage: 0,
          days: []
        };
      }
      
      // Parse status
      const statusValue = row[statusIndex] ? row[statusIndex].toLowerCase() : '';
      const isPresent = statusValue.includes('p') || statusValue.includes('present') || statusValue === '1';
      
      // Parse time status
      let timeStatus = '';
      if (timeIndex !== -1 && row[timeIndex]) {
        const timeValue = row[timeIndex].toLowerCase();
        if (timeValue.includes('late') || timeValue.includes('delay')) {
          timeStatus = 'late';
        } else if (isPresent) {
          timeStatus = 'on-time';
        }
      } else if (isPresent) {
        timeStatus = 'on-time'; // Default for present students
      }
      
      // Add day to month
      attendanceByMonth[monthKey].days.push({
        day,
        isSchoolDay: true,
        status: isPresent ? 'present' : 'absent',
        timeStatus
      });
      
      // Update monthly counters
      attendanceByMonth[monthKey].totalDays++;
      if (isPresent) {
        attendanceByMonth[monthKey].daysPresent++;
      } else {
        attendanceByMonth[monthKey].daysAbsent++;
      }
      
      // Update yearly counters
      totalSchoolDays++;
      if (isPresent) totalPresent++;
    });
    
    // Calculate percentages and format months as array
    const months = Object.values(attendanceByMonth).map(month => {
      if (month.totalDays > 0) {
        month.percentage = ((month.daysPresent / month.totalDays) * 100).toFixed(1);
      }
      return month;
    });
    
    // Fill in weekend days for complete calendar display
    months.forEach(month => {
      const daysInMonth = new Date(month.year, month.month + 1, 0).getDate();
      
      // Create a map for quick lookup of existing days
      const existingDays = {};
      month.days.forEach(day => {
        existingDays[day.day] = true;
      });
      
      // Add missing days (weekends and holidays)
      for (let day = 1; day <= daysInMonth; day++) {
        if (!existingDays[day]) {
          const date = new Date(month.year, month.month, day);
          const dayOfWeek = date.getDay();
          const isWeekend = (dayOfWeek === 0 || dayOfWeek === 6);
          
          month.days.push({
            day,
            isSchoolDay: false,
            status: 'no-school',
            timeStatus: '',
            isWeekend
          });
        }
      }
      
      // Sort days numerically
      month.days.sort((a, b) => a.day - b.day);
    });
    
    // Create full attendance data object
    const attendanceData = {
      attendance: {
        yearToDate: {
          totalDays: totalSchoolDays,
          daysPresent: totalPresent,
          daysAbsent: totalSchoolDays - totalPresent,
          percentage: totalSchoolDays > 0 ? ((totalPresent / totalSchoolDays) * 100).toFixed(1) : 0
        },
        months
      }
    };
    
    res.json({ success: true, data: attendanceData });
  } catch (error) {
    console.error('Error fetching attendance data:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Combines both endpoints for a single request option
app.get('/api/student/:rollNumber/combined', async (req, res) => {
  try {
    // Get student info
    const sheets = google.sheets({ version: 'v4', auth: API_KEY });
    const studentResponse = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: 'Students!A:G',
    });
    
    if (!studentResponse.data.values || studentResponse.data.values.length <= 1) {
      return res.status(404).json({ success: false, message: 'No student data found in the sheet' });
    }
    
    // Assuming first row is header
    const studentHeaders = studentResponse.data.values[0];
    
    // Find the Roll Number column index
    const rollIndex = studentHeaders.findIndex(header => 
      header.toLowerCase().includes('roll') || 
      header.toLowerCase().includes('admission') || 
      header.toLowerCase().includes('id'));
    
    if (rollIndex === -1) {
      return res.status(400).json({ success: false, message: 'Roll Number column not found' });
    }
    
    // Find student by roll number
    const studentRow = studentResponse.data.values.find(row => row[rollIndex] === req.params.rollNumber);
    
    if (!studentRow) {
      return res.status(404).json({ success: false, message: 'Student not found' });
    }
    
    // Map student data
    const student = {
      name: studentRow[studentHeaders.findIndex(h => h.toLowerCase().includes('name') && !h.toLowerCase().includes('father') && !h.toLowerCase().includes('mother'))] || 'N/A',
      class: studentRow[studentHeaders.findIndex(h => h.toLowerCase().includes('class'))] || 'N/A',
      school: 'Kendriya Vidyalaya', // Can be dynamically set if needed
      dob: studentRow[studentHeaders.findIndex(h => h.toLowerCase().includes('dob') || h.toLowerCase().includes('birth'))] || 'N/A',
      fatherName: studentRow[studentHeaders.findIndex(h => h.toLowerCase().includes('father'))] || 'N/A',
      motherName: studentRow[studentHeaders.findIndex(h => h.toLowerCase().includes('mother'))] || 'N/A'
    };
    
    // Now get attendance data
    const attendanceResponse = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: 'Attendance!A:Z',
    });
    
    // Default attendance object in case there's no data
    let attendanceData = {
      attendance: {
        yearToDate: {
          totalDays: 0,
          daysPresent: 0,
          daysAbsent: 0,
          percentage: 0
        },
        months: []
      }
    };
    
    if (attendanceResponse.data.values && attendanceResponse.data.values.length > 1) {
      // Process attendance data (same as the code in the separate endpoint)
      const headers = attendanceResponse.data.values[0];
      const attendanceRollIndex = headers.findIndex(header => 
        header.toLowerCase().includes('roll') || 
        header.toLowerCase().includes('admission') || 
        header.toLowerCase().includes('id'));
      
      const dateIndex = headers.findIndex(h => h.toLowerCase().includes('date'));
      const statusIndex = headers.findIndex(h => h.toLowerCase().includes('status') || h.toLowerCase().includes('present') || h.toLowerCase().includes('absent'));
      const timeIndex = headers.findIndex(h => h.toLowerCase().includes('time') || h.toLowerCase().includes('late'));
      
      if (attendanceRollIndex !== -1 && dateIndex !== -1 && statusIndex !== -1) {
        // Find rows for this student
        const studentAttendanceRows = attendanceResponse.data.values.filter(row => row[attendanceRollIndex] === req.params.rollNumber);
        
        if (studentAttendanceRows.length > 0) {
          // Process attendance data (same logic as earlier)
          // ... (process attendance as in the separate endpoint)
          // Process attendance data by month
          const attendanceByMonth = {};
          let totalSchoolDays = 0;
          let totalPresent = 0;
          
          studentAttendanceRows.forEach(row => {
            const dateStr = row[dateIndex];
            if (!dateStr) return;
            
            // Parse date from format DD/MM/YYYY or MM/DD/YYYY
            let date;
            if (dateStr.includes('/')) {
              const parts = dateStr.split('/');
              if (parts.length === 3) {
                if (parts[0].length <= 2 && parts[1].length <= 2) {
                  // Assuming DD/MM/YYYY format
                  date = new Date(`${parts[1]}/${parts[0]}/${parts[2]}`);
                } else {
                  // Assuming MM/DD/YYYY format
                  date = new Date(dateStr);
                }
              }
            } else if (dateStr.includes('-')) {
              date = new Date(dateStr);
            } else {
              return; // Skip if date format is unknown
            }
            
            if (isNaN(date.getTime())) return; // Skip invalid dates
            
            const month = date.getMonth();
            const year = date.getFullYear();
            const day = date.getDate();
            
            // Create month entry if it doesn't exist
            const monthKey = `${month}-${year}`;
            if (!attendanceByMonth[monthKey]) {
              attendanceByMonth[monthKey] = {
                month,
                year,
                totalDays: 0,
                daysPresent: 0,
                daysAbsent: 0,
                percentage: 0,
                days: []
              };
            }
            
            // Parse status
            const statusValue = row[statusIndex] ? row[statusIndex].toLowerCase() : '';
            const isPresent = statusValue.includes('p') || statusValue.includes('present') || statusValue === '1';
            
            // Parse time status
            let timeStatus = '';
            if (timeIndex !== -1 && row[timeIndex]) {
              const timeValue = row[timeIndex].toLowerCase();
              if (timeValue.includes('late') || timeValue.includes('delay')) {
                timeStatus = 'late';
              } else if (isPresent) {
                timeStatus = 'on-time';
              }
            } else if (isPresent) {
              timeStatus = 'on-time'; // Default for present students
            }
            
            // Add day to month
            attendanceByMonth[monthKey].days.push({
              day,
              isSchoolDay: true,
              status: isPresent ? 'present' : 'absent',
              timeStatus
            });
            
            // Update monthly counters
            attendanceByMonth[monthKey].totalDays++;
            if (isPresent) {
              attendanceByMonth[monthKey].daysPresent++;
            } else {
              attendanceByMonth[monthKey].daysAbsent++;
            }
            
            // Update yearly counters
            totalSchoolDays++;
            if (isPresent) totalPresent++;
          });
          
          // Calculate percentages and format months as array
          const months = Object.values(attendanceByMonth).map(month => {
            if (month.totalDays > 0) {
              month.percentage = ((month.daysPresent / month.totalDays) * 100).toFixed(1);
            }
            return month;
          });
          
          // Fill in weekend days for complete calendar display
          months.forEach(month => {
            const daysInMonth = new Date(month.year, month.month + 1, 0).getDate();
            
            // Create a map for quick lookup of existing days
            const existingDays = {};
            month.days.forEach(day => {
              existingDays[day.day] = true;
            });
            
            // Add missing days (weekends and holidays)
            for (let day = 1; day <= daysInMonth; day++) {
              if (!existingDays[day]) {
                const date = new Date(month.year, month.month, day);
                const dayOfWeek = date.getDay();
                const isWeekend = (dayOfWeek === 0 || dayOfWeek === 6);
                
                month.days.push({
                  day,
                  isSchoolDay: false,
                  status: 'no-school',
                  timeStatus: '',
                  isWeekend
                });
              }
            }
            
            // Sort days numerically
            month.days.sort((a, b) => a.day - b.day);
          });
          
          // Create full attendance data object
          attendanceData = {
            attendance: {
              yearToDate: {
                totalDays: totalSchoolDays,
                daysPresent: totalPresent,
                daysAbsent: totalSchoolDays - totalPresent,
                percentage: totalSchoolDays > 0 ? ((totalPresent / totalSchoolDays) * 100).toFixed(1) : 0
              },
              months
            }
          };
        }
      }
    }
    
    // Return combined data
    res.json({ 
      success: true, 
      data: {
        student,
        attendance: attendanceData.attendance
      }
    });
  } catch (error) {
    console.error('Error fetching combined data:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Start server
app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
