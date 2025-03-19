// app.js - Complete updated version with improved horizontal data support
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

// Add a test endpoint to help with debugging
app.get('/test', async (req, res) => {
  try {
    res.json({ 
      success: true, 
      message: 'Test endpoint working',
      env: {
        sheetId: SHEET_ID ? 'Set properly' : 'Missing',
        apiKey: API_KEY ? 'Key exists' : 'Missing'
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Endpoint to get student data
app.get('/api/student/:rollNumber', async (req, res) => {
  try {
    const sheets = google.sheets({ version: 'v4' });
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: 'Students!A:G',
      key: API_KEY
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

// Endpoint to get attendance data with improved column detection
app.get('/api/student/:rollNumber/attendance', async (req, res) => {
  try {
    const sheets = google.sheets({ version: 'v4' });
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: 'Attendance!A:Z',
      key: API_KEY
    });
    
    if (!response.data.values || response.data.values.length <= 1) {
      return res.status(404).json({ success: false, message: 'No attendance data found in the sheet' });
    }
    
    // Assuming first row has column headers
    const headerRow = response.data.values[0];
    
    // Find roll number column index (typically first column)
    const rollIndex = headerRow.findIndex(header => 
      header && header.toString().toLowerCase().includes('roll') || 
      (header && header.toString().toLowerCase().includes('admission')) || 
      (header && header.toString().toLowerCase().includes('id')));
    
    if (rollIndex === -1) {
      return res.status(400).json({ success: false, message: 'Roll Number column not found' });
    }
    
    // Find the student row with the matching roll number
    const studentRow = response.data.values.find(row => row[rollIndex] === req.params.rollNumber);
    
    if (!studentRow) {
      return res.status(404).json({ success: false, message: 'No attendance records found for this student' });
    }
    
    // Extract date columns with improved detection for numbered headers
    const dateColumnGroups = [];
    
    // Better date column detection that handles numbered headers
    for (let i = rollIndex + 1; i < headerRow.length; i++) {
      const headerText = headerRow[i] ? headerRow[i].toString().toLowerCase() : '';
      
      // Check if this column is a date column (looks for "date" in header or is date-like)
      if (headerText.includes('date') || isDateLike(headerRow[i])) {
        // Try to find corresponding status and time columns
        let statusCol = -1;
        let timeCol = -1;
        
        // Look for status column (either next column or by name)
        for (let j = i + 1; j < Math.min(i + 4, headerRow.length); j++) {
          const colHeader = headerRow[j] ? headerRow[j].toString().toLowerCase() : '';
          if (colHeader.includes('status') || colHeader.includes('present') || colHeader.includes('absent')) {
            statusCol = j;
            break;
          }
        }
        
        // If status column not found by name, assume it's the next column
        if (statusCol === -1 && i + 1 < headerRow.length) {
          statusCol = i + 1;
        }
        
        // Look for time column (either after status or by name)
        if (statusCol !== -1) {
          for (let j = statusCol + 1; j < Math.min(statusCol + 3, headerRow.length); j++) {
            const colHeader = headerRow[j] ? headerRow[j].toString().toLowerCase() : '';
            if (colHeader.includes('time') || colHeader.includes('late')) {
              timeCol = j;
              break;
            }
          }
          
          // If time column not found by name, assume it's the next column after status
          if (timeCol === -1 && statusCol + 1 < headerRow.length) {
            timeCol = statusCol + 1;
          }
        }
        
        // Only add if we found a valid group
        if (statusCol !== -1) {
          dateColumnGroups.push({
            dateCol: i,
            statusCol: statusCol,
            timeCol: timeCol !== -1 ? timeCol : statusCol + 1 // Default to next column if not found
          });
          
          // Skip to after this group
          i = timeCol !== -1 ? timeCol : statusCol;
        }
      }
    }
    
    // Add debug logging to see what columns were detected
    console.log("Detected date column groups:", dateColumnGroups.map(g => ({
      date: headerRow[g.dateCol],
      status: headerRow[g.statusCol],
      time: g.timeCol < headerRow.length ? headerRow[g.timeCol] : "N/A"
    })));
    
    if (dateColumnGroups.length === 0) {
      return res.status(400).json({ success: false, message: 'No date columns found in attendance sheet' });
    }
    
    // Process attendance data by month
    const attendanceByMonth = {};
    let totalSchoolDays = 0;
    let totalPresent = 0;
    
    dateColumnGroups.forEach(group => {
      const dateStr = headerRow[group.dateCol];
      const statusValue = studentRow[group.statusCol] ? studentRow[group.statusCol].toString().toLowerCase() : '';
      const timeValue = group.timeCol < studentRow.length ? studentRow[group.timeCol] : '';
      
      if (!dateStr) return;
      
      // Parse date from format DD/MM/YYYY or MM/DD/YYYY
      let date = parseDate(dateStr);
      
      if (!date || isNaN(date.getTime())) return; // Skip invalid dates
      
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
      const isPresent = statusValue.includes('p') || statusValue.includes('present') || statusValue === '1';
      
      // Parse time status
      let timeStatus = '';
      if (timeValue) {
        if (timeValue.toString().toLowerCase().includes('late') || 
            timeValue.toString().toLowerCase().includes('delay')) {
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
    
    // Fill in weekend days (Sundays) and missing days as holidays
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
          const isSunday = dayOfWeek === 0;
          
          month.days.push({
            day,
            isSchoolDay: false,
            status: 'no-school',
            timeStatus: '',
            isWeekend: isSunday,
            isSunday: isSunday,
            isHoliday: !isSunday // If not Sunday, and not in data, mark as holiday
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
    const sheets = google.sheets({ version: 'v4' });
    const studentResponse = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: 'Students!A:G',
      key: API_KEY
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
    
    // Now get attendance data using the new horizontal format
    const attendanceResponse = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: 'Attendance!A:Z',
      key: API_KEY
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
      // Process the horizontal attendance data
      const headerRow = attendanceResponse.data.values[0];
      
      // Find roll number column
      const attendanceRollIndex = headerRow.findIndex(header => 
        header && header.toString().toLowerCase().includes('roll') || 
        (header && header.toString().toLowerCase().includes('admission')) || 
        (header && header.toString().toLowerCase().includes('id')));
      
      if (attendanceRollIndex !== -1) {
        // Find the student row
        const studentAttendanceRow = attendanceResponse.data.values.find(row => 
          row[attendanceRollIndex] === req.params.rollNumber);
        
        if (studentAttendanceRow) {
          // Extract date columns with improved detection for numbered headers
          const dateColumnGroups = [];
          
          // Better date column detection that handles numbered headers
          for (let i = attendanceRollIndex + 1; i < headerRow.length; i++) {
            const headerText = headerRow[i] ? headerRow[i].toString().toLowerCase() : '';
            
            // Check if this column is a date column (looks for "date" in header or is date-like)
            if (headerText.includes('date') || isDateLike(headerRow[i])) {
              // Try to find corresponding status and time columns
              let statusCol = -1;
              let timeCol = -1;
              
              // Look for status column (either next column or by name)
              for (let j = i + 1; j < Math.min(i + 4, headerRow.length); j++) {
                const colHeader = headerRow[j] ? headerRow[j].toString().toLowerCase() : '';
                if (colHeader.includes('status') || colHeader.includes('present') || colHeader.includes('absent')) {
                  statusCol = j;
                  break;
                }
              }
              
              // If status column not found by name, assume it's the next column
              if (statusCol === -1 && i + 1 < headerRow.length) {
                statusCol = i + 1;
              }
              
              // Look for time column (either after status or by name)
              if (statusCol !== -1) {
                for (let j = statusCol + 1; j < Math.min(statusCol + 3, headerRow.length); j++) {
                  const colHeader = headerRow[j] ? headerRow[j].toString().toLowerCase() : '';
                  if (colHeader.includes('time') || colHeader.includes('late')) {
                    timeCol = j;
                    break;
                  }
                }
                
                // If time column not found by name, assume it's the next column after status
                if (timeCol === -1 && statusCol + 1 < headerRow.length) {
                  timeCol = statusCol + 1;
                }
              }
              
              // Only add if we found a valid group
              if (statusCol !== -1) {
                dateColumnGroups.push({
                  dateCol: i,
                  statusCol: statusCol,
                  timeCol: timeCol !== -1 ? timeCol : statusCol + 1 // Default to next column if not found
                });
                
                // Skip to after this group
                i = timeCol !== -1 ? timeCol : statusCol;
              }
            }
          }
          
          // Add debug logging to see what columns were detected
          console.log("Detected date column groups:", dateColumnGroups.map(g => ({
            date: headerRow[g.dateCol],
            status: headerRow[g.statusCol],
            time: g.timeCol < headerRow.length ? headerRow[g.timeCol] : "N/A"
          })));
          
          // Process attendance data by month
          const attendanceByMonth = {};
          let totalSchoolDays = 0;
          let totalPresent = 0;
          
          dateColumnGroups.forEach(group => {
            const dateStr = headerRow[group.dateCol];
            const statusValue = studentAttendanceRow[group.statusCol] ? studentAttendanceRow[group.statusCol].toString().toLowerCase() : '';
            const timeValue = group.timeCol < studentAttendanceRow.length ? studentAttendanceRow[group.timeCol] : '';
            
            if (!dateStr) return;
            
            // Parse date from format DD/MM/YYYY or MM/DD/YYYY
            let date = parseDate(dateStr);
            
            if (!date || isNaN(date.getTime())) return; // Skip invalid dates
            
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
            const isPresent = statusValue.includes('p') || statusValue.includes('present') || statusValue === '1';
            
            // Parse time status
            let timeStatus = '';
            if (timeValue) {
              if (timeValue.toString().toLowerCase().includes('late') || 
                  timeValue.toString().toLowerCase().includes('delay')) {
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
          
          // Fill in weekend days (Sundays) and missing days as holidays
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
                const isSunday = dayOfWeek === 0;
                
                month.days.push({
                  day,
                  isSchoolDay: false,
                  status: 'no-school',
                  timeStatus: '',
                  isWeekend: isSunday,
                  isSunday: isSunday,
                  isHoliday: !isSunday // If not Sunday, mark as holiday
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

// Helper function to check if a string is a date
function isDateLike(str) {
  if (!str) return false;
  
  // If it's a header with "date" in it, consider it a date column
  if (typeof str === 'string' && str.toLowerCase().includes('date')) {
    return true;
  }
  
  // Convert to string if not already
  const dateStr = str.toString();
  
  // Check for DD/MM/YYYY or MM/DD/YYYY format
  if (dateStr.includes('/')) {
    const parts = dateStr.split('/');
    if (parts.length === 3) {
      // Check if all parts are numbers
      return parts.every(part => !isNaN(parseInt(part)));
    }
  }
  
  // Check for YYYY-MM-DD format
  if (dateStr.includes('-')) {
    const parts = dateStr.split('-');
    if (parts.length === 3) {
      // Check if all parts are numbers
      return parts.every(part => !isNaN(parseInt(part)));
    }
  }
  
  // Try date parsing as a last resort
  try {
    const date = new Date(dateStr);
    return !isNaN(date.getTime());
  } catch (e) {
    return false;
  }
}

// Helper function to parse dates in different formats
function parseDate(dateStr) {
  if (!dateStr) return null;
  
  // Convert to string if it's not already
  const str = dateStr.toString();
  
  // Try DD/MM/YYYY format
  if (str.includes('/')) {
    const parts = str.split('/');
    if (parts.length === 3) {
      if (parts[0].length <= 2 && parts[1].length <= 2) {
        // Assuming DD/MM/YYYY format
        return new Date(`${parts[1]}/${parts[0]}/${parts[2]}`);
      } else {
        // Assuming MM/DD/YYYY format
        return new Date(str);
      }
    }
  }
  
  // Try YYYY-MM-DD format
  if (str.includes('-')) {
    const parts = str.split('-');
    if (parts.length === 3) {
      return new Date(str);
    }
  }
  
  // Last resort, try direct parsing
  return new Date(str);
}

// Start server
app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
