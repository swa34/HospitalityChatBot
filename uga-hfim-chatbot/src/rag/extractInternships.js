// improvedExtractInternships.js - Better extraction patterns
import fs from 'fs';
import path from 'path';

// List of common false positives to exclude
const falsePositives = [
  'Human Resources',
  'Event Management',
  'Room Operations',
  'United States',
  'Weekly Report',
  'Beverage Operations',
  'Event Coordinator',
  'Amazing Event',
  'Executive Director',
  'On Friday',
  'On Thursday',
  'On Learning',
  'The Classic',
  'Food And',
  'Dining Room',
  'Great Wolf',
  'Artificial Intelligence',
  'Aspiring Sales',
  'Clearwater Beach',
  'Orlando World',
  'Hours Worked',
  'The End',
  'The Tower',
  'Development Group',
  'Mental Health',
  'Show all',
  'Connect',
  'Customer Service',
  'Front Desk',
  'Basic Food',
  'Moore Road',
  'The Athens',
  'Verified Working',
  'Big Party Event',
  'Columbus Aesthetic',
  'Abraham Baldwin',
  'And Sunday',
  'Message',
  'Weekly',
  'Report',
];

// Known organization keywords to help identify real companies
const orgKeywords = [
  'College',
  'University',
  'UGA',
  'Hotel',
  'Resort',
  'Restaurant',
  'Chick-fil-A',
  'CFA',
  'Center',
  'Lodge',
  'Country Club',
  'Events',
  'Catering',
  'Company',
  'LLC',
  'Inc',
  'Corporation',
  'Suites',
  'Brewing',
  'Vineyards',
  'Winery',
  'Garden',
  'Botanical',
  'Stadium',
  'Athletics',
  'Disney',
  'National',
  'Financial',
  'Services',
];

// Validate if a string is likely a real person's name
function isValidStudentName(name) {
  if (!name || name === 'Unknown') return false;

  // Check against false positives
  if (
    falsePositives.some(fp => name.toLowerCase().includes(fp.toLowerCase()))
  ) {
    return false;
  }

  // Must match standard name pattern
  const validNamePattern = /^[A-Z][a-z]+([-\s][A-Z][a-z]+)+$/;
  if (!validNamePattern.test(name)) return false;

  // Must have exactly 2 or 3 parts (First Last or First Middle Last)
  const parts = name.split(/\s+/);
  if (parts.length < 2 || parts.length > 3) return false;

  // Each part should be a reasonable length
  if (parts.some(p => p.length < 2 || p.length > 15)) return false;

  // Should not contain organization keywords
  if (orgKeywords.some(k => name.includes(k))) return false;

  // Should not contain numbers or special characters except hyphen
  if (/[0-9&@#$%^*()_+={}[\]|\\:;"'<>,.?/]/.test(name)) return false;

  return true;
}

function extractInternshipInfo(text, fileName) {
  const internships = [];

  // Common student name patterns to exclude
  const namePatterns = [
    /^[A-Z][a-z]+ [A-Z][a-z]+$/, // Simple First Last
    /^[A-Z][a-z]+ [A-Z]\. [A-Z][a-z]+$/, // First M. Last
  ];

  // Pattern 1: Look for explicit internship mentions with organizations
  const internshipPatterns = [
    // "Organization Name - Role/Department"
    /^([A-Z][A-Za-z\s&\-'\.]+(?:College|University|UGA|Hotel|Resort|Restaurant|Chick-fil-A|Center|Lodge|Club|Events|Catering|Company|LLC|Inc|Corporation|Suites|Brewing|Vineyards|Winery|Garden|Stadium|Disney|National|Financial|Services)[A-Za-z\s&\-'\.]*)\s*[-–]\s*([A-Za-z\s]+(?:Intern|Internship|Management|Planning|Catering|Sales|Event))/gm,

    // "Internship at/with Organization"
    /(?:internship|intern|interned|working|worked)\s+(?:at|with|for)\s+([A-Z][A-Za-z\s&\-'\.]+(?:College|University|UGA|Hotel|Resort|Restaurant|Chick-fil-A|Center|Lodge|Club|Events|Catering|Company|LLC|Inc|Corporation|Suites|Brewing|Vineyards|Winery|Garden|Stadium|Disney|National|Financial|Services)[A-Za-z\s&\-'\.]*)/gi,

    // Specific patterns from your documents
    /^([A-Z][A-Za-z\s&\-'\.]+)\s*\n\s*([A-Z][a-z]+ [A-Z][a-z]+)\s*\n\s*Report/gm,

    // "Student Name\nOrganization\nReport #"
    /^([A-Z][a-z]+ [A-Z][a-z]+)\s*\n\s*([A-Z][A-Za-z\s&\-'\.]+)\s*\n\s*Report\s*#?\d+/gm,
  ];

  // Extract based on patterns
  internshipPatterns.forEach(pattern => {
    let match;
    const patternCopy = new RegExp(pattern.source, pattern.flags);

    while ((match = patternCopy.exec(text)) !== null) {
      let organization = '';
      let student = '';

      // Determine which capture group has the organization
      if (match[2] && match[1]) {
        // Check if match[1] looks like a valid person name
        const isName = isValidStudentName(match[1].trim());

        if (isName) {
          student = match[1].trim();
          organization = match[2].trim();
        } else {
          organization = match[1].trim();
          const potentialStudent = match[2] ? match[2].trim() : '';
          student = isValidStudentName(potentialStudent)
            ? potentialStudent
            : 'Unknown';
        }
      } else if (match[1]) {
        organization = match[1].trim();
      }

      // Validate organization name
      const hasOrgKeyword = orgKeywords.some(keyword =>
        organization.toLowerCase().includes(keyword.toLowerCase())
      );

      // Skip if it's clearly a person's name or doesn't have org keywords
      const looksLikeName = namePatterns.some(np => np.test(organization));

      if (
        organization &&
        !looksLikeName &&
        (hasOrgKeyword || organization.length > 10) &&
        !organization.includes('Due:') &&
        !organization.includes('Week ') &&
        !organization.match(/^\d/) &&
        organization.length < 100
      ) {
        // Check if we already have this internship
        const exists = internships.some(
          i =>
            i.organization.toLowerCase() === organization.toLowerCase() ||
            (i.student === student && student !== 'Unknown')
        );

        if (!exists) {
          internships.push({
            student: student,
            organization: organization,
            source: fileName,
          });
        }
      }
    }
  });

  // Pattern 2: Look for specific known organizations from your docs
  const knownOrganizations = [
    {
      pattern: /UGA Grady College/i,
      org: 'UGA Grady College',
      dept: 'Event Planning',
    },
    {
      pattern: /Athens Chick-fil-A.*Barnett Shoals/i,
      org: 'Athens Chick-fil-A (Barnett Shoals)',
      dept: 'Catering',
    },
    {
      pattern: /Chick-fil-A Beechwood/i,
      org: 'Chick-fil-A Beechwood',
      dept: '',
    },
    {
      pattern: /Chick-fil-A Moore Road/i,
      org: 'Chick-fil-A Moore Road',
      dept: '',
    },
    {
      pattern: /State Botanical Garden of Georgia/i,
      org: 'State Botanical Garden of Georgia',
      dept: 'Special Events',
    },
    {
      pattern: /Georgia Center.*Hotel|UGA Center for Continuing Education/i,
      org: 'UGA Center for Continuing Education & Hotel',
      dept: 'Sales & Event Management',
    },
    {
      pattern: /Proof of the Pudding/i,
      org: 'Proof of the Pudding',
      dept: 'Catering',
    },
    { pattern: /Trump(?:')?s Catering/i, org: "Trump's Catering", dept: '' },
    { pattern: /Epting Events/i, org: 'Epting Events', dept: 'Event Planning' },
    {
      pattern: /Springhill Suites/i,
      org: 'Springhill Suites',
      dept: 'Hotel Operations',
    },
    {
      pattern: /Hotel Indigo/i,
      org: 'Hotel Indigo Athens',
      dept: 'Hotel Operations',
    },
    {
      pattern: /The Classic Center/i,
      org: 'The Classic Center',
      dept: 'Event Management',
    },
    { pattern: /Chateau Elan/i, org: 'Chateau Elan Winery & Resort', dept: '' },
    {
      pattern: /Augusta National.*Masters/i,
      org: 'Augusta National (Masters Tournament)',
      dept: '',
    },
    {
      pattern: /Disney\s*World|Walt\s*Disney/i,
      org: 'Walt Disney World',
      dept: '',
    },
    { pattern: /Great Wolf Lodge/i, org: 'Great Wolf Lodge', dept: '' },
    { pattern: /Hyatt Regency/i, org: 'Hyatt Regency', dept: '' },
    { pattern: /Engelheim Vineyards/i, org: 'Engelheim Vineyards', dept: '' },
    { pattern: /Athens Country Club/i, org: 'Athens Country Club', dept: '' },
    {
      pattern: /Jennings Mill Country Club/i,
      org: 'Jennings Mill Country Club',
      dept: '',
    },
    {
      pattern: /Big Peach Running Co/i,
      org: 'Big Peach Running Co.',
      dept: '',
    },
    {
      pattern: /Akademia Brewing Company/i,
      org: 'Akademia Brewing Company',
      dept: '',
    },
    {
      pattern: /Beech Haven Baptist Church/i,
      org: 'Beech Haven Baptist Church',
      dept: '',
    },
    { pattern: /The Chapel Athens/i, org: 'The Chapel Athens', dept: '' },
    { pattern: /Ricardo's Kouzzina/i, org: "Ricardo's Kouzzina", dept: '' },
    {
      pattern: /5\s*&\s*10|Five\s*and\s*Ten/i,
      org: '5&10 Restaurant',
      dept: '',
    },
    {
      pattern: /Lendmark Financial Services/i,
      org: 'Lendmark Financial Services',
      dept: '',
    },
    {
      pattern: /Lothlórien Events LLC/i,
      org: 'Lothlórien Events LLC',
      dept: 'Event Planning',
    },
    {
      pattern: /Akademia Brewing Company/i,
      org: 'Akademia Brewing Company',
      dept: '',
    },
    { pattern: /JL Photography World/i, org: 'JL Photography World', dept: '' },
  ];

  // Known student-organization pairs from explicit mentions
  const knownPairs = [
    {
      student: 'Madison Bracewell',
      org: 'UGA Grady College',
      dept: 'Event Planning',
    },
    {
      student: 'Trevor Hixson',
      org: 'Athens Chick-fil-A (Barnett Shoals)',
      dept: 'Catering',
    },
    { student: 'Copleigh Thomas', org: 'Chick-fil-A Beechwood', dept: '' },
    { student: 'Madison Heck', org: "Trump's Catering", dept: '' },
    { student: 'Ellis McKinney', org: 'Jennings Mill Country Club', dept: '' },
    { student: 'Ashleigh Lang', org: 'Engelheim Vineyards', dept: '' },
    { student: 'Brenna Clark', org: 'Epting Events', dept: 'Event Planning' },
    {
      student: 'Sydney Baumgardner',
      org: 'Epting Events',
      dept: 'Event Planning',
    },
    {
      student: 'Faye Fudjinski',
      org: 'UGA Center for Continuing Education & Hotel',
      dept: 'Sales & Event Management',
    },
    {
      student: 'Madison Wagner',
      org: 'State Botanical Garden of Georgia',
      dept: 'Special Events',
    },
    {
      student: 'Arianna Castillo',
      org: 'Springhill Suites',
      dept: 'Hotel Operations',
    },
    { student: 'Kaitlyn Hart', org: 'Beech Haven Baptist Church', dept: '' },
    {
      student: 'Jackie Lenskold',
      org: 'Chateau Elan Winery & Resort',
      dept: '',
    },
    { student: 'Maria Cardoso', org: 'Chick-fil-A Moore Road', dept: '' },
    { student: 'Julia Fabian', org: 'Don Lee Center', dept: '' },
    { student: 'Natalie Ellison', org: 'Alumni Cookie Dough', dept: '' },
    {
      student: 'Ellie Lancaster',
      org: 'State Botanical Garden of Georgia',
      dept: 'Special Events',
    },
    { student: 'Kyle Ehmig', org: 'Chateau Elan Winery & Resort', dept: '' },
    { student: 'Lillian Creamer', org: 'Big Peach Running Co.', dept: '' },
    {
      student: 'Tamara English',
      org: 'Lothlórien Events LLC',
      dept: 'Event Planning',
    },
    { student: 'Mary-Wesley Conner', org: 'The Chapel Athens', dept: '' },
    {
      student: 'Cameron Bartsch',
      org: 'Hotel Indigo Athens',
      dept: 'Hotel Operations',
    },
    { student: 'Emma Young', org: 'Lendmark Financial Services', dept: '' },
    {
      student: 'Madison Ehmig',
      org: 'UGA Center for Continuing Education & Hotel',
      dept: 'Sales & Event Management',
    },
    {
      student: 'Bobby Gillespie',
      org: 'UGA Center for Continuing Education & Hotel',
      dept: 'Hotel Division',
    },
    { student: 'Abigail Glass', org: "Ricardo's Kouzzina", dept: '' },
    {
      student: 'Morgan Schmidt',
      org: 'The Classic Center',
      dept: 'Event Management',
    },
    { student: 'James Shin', org: 'Glam 104', dept: '' },
    {
      student: 'Grace Carty',
      org: 'Hotel Indigo Athens',
      dept: 'Hotel Operations',
    },
    {
      student: 'Meagan Warren',
      org: 'UGA Center for Continuing Education & Hotel',
      dept: 'Food & Beverage',
    },
    {
      student: 'Frances Williams',
      org: 'UGA Center for Continuing Education & Hotel',
      dept: 'Special Events',
    },
  ];

  // Search for known organizations
  knownOrganizations.forEach(({ pattern, org, dept }) => {
    if (pattern.test(text)) {
      // Try to find associated student name nearby
      let student = 'Unknown';

      // Look for student name patterns near the organization mention
      const orgIndex = text.search(pattern);
      if (orgIndex !== -1) {
        // Get surrounding text (300 chars before and after)
        const contextStart = Math.max(0, orgIndex - 300);
        const contextEnd = Math.min(text.length, orgIndex + 300);
        const context = text.substring(contextStart, contextEnd);

        // Look for student names in context - try multiple patterns
        const studentPatterns = [
          // "Student Name\nOrganization"
          /([A-Z][a-z]+ [A-Z][a-z]+)\s*\n\s*(?:internship|working|worked|position|role)/i,
          // In a header format
          /^([A-Z][a-z]+ [A-Z][a-z]+)\s*$/m,
          // After "by" or "student:"
          /(?:by|student:|intern:)\s*([A-Z][a-z]+ [A-Z][a-z]+)/i,
        ];

        for (const studentPattern of studentPatterns) {
          const studentMatch = context.match(studentPattern);
          if (studentMatch && studentMatch[1]) {
            const potentialName = studentMatch[1].trim();
            if (isValidStudentName(potentialName)) {
              student = potentialName;
              break;
            }
          }
        }
      }

      // Check if we already have this
      const exists = internships.some(
        i =>
          i.organization === org &&
          (i.student === student || student === 'Unknown')
      );

      if (!exists) {
        internships.push({
          student: student,
          organization: org,
          department: dept,
          source: fileName,
        });
      }
    }
  });

  // Add known pairs if they're mentioned in the text
  knownPairs.forEach(({ student, org, dept }) => {
    // Check if both student and org appear in the text (not necessarily together)
    const studentPattern = new RegExp(student.replace(/\s+/g, '\\s+'), 'i');
    const orgPattern = new RegExp(
      org.replace(/[()]/g, '\\$&').replace(/\s+/g, '\\s+'),
      'i'
    );

    if (studentPattern.test(text) || orgPattern.test(text)) {
      const exists = internships.some(
        i => i.organization === org && i.student === student
      );

      if (!exists) {
        internships.push({
          student: student,
          organization: org,
          department: dept,
          source: fileName,
        });
      }
    }
  });

  return internships;
}

function processInternshipDocuments() {
  const docsDir = path.resolve('docs');
  const internshipData = [];

  // Read all text files
  const files = fs
    .readdirSync(docsDir)
    .filter(f => f.endsWith('.txt') || f.endsWith('.md'));

  files.forEach(file => {
    // Skip the existing summary file
    if (file === 'internship-summary.md') return;

    const content = fs.readFileSync(path.join(docsDir, file), 'utf-8');
    const internships = extractInternshipInfo(content, file);
    internshipData.push(...internships);
  });

  // Deduplicate by organization and student
  const uniqueMap = new Map();

  internshipData.forEach(item => {
    const key = `${item.organization}|||${item.student}`;
    if (!uniqueMap.has(key) || item.student !== 'Unknown') {
      uniqueMap.set(key, item);
    }
  });

  const uniqueInternships = Array.from(uniqueMap.values());

  // Group by organization
  const byOrganization = uniqueInternships.reduce((acc, curr) => {
    const org = curr.organization;
    if (!acc[org]) acc[org] = [];
    if (curr.student !== 'Unknown' || acc[org].length === 0) {
      acc[org].push(curr);
    }
    return acc;
  }, {});

  // Create a summary document
  let summaryContent = `# HFIM Student Internship Placements

Source: Extracted from HFIM student internship reports

## Summary
Total Organizations: ${Object.keys(byOrganization).length}
Total Identified Students: ${
    uniqueInternships.filter(
      i => i.student !== 'Unknown' && isValidStudentName(i.student)
    ).length
  }

## Internship Locations by Organization:\n\n`;

  // Sort by number of students (most popular first)
  Object.entries(byOrganization)
    .sort((a, b) => {
      // Sort by number of valid students, then by org name
      const aValidStudents = b[1].filter(
        i => i.student !== 'Unknown' && isValidStudentName(i.student)
      ).length;
      const bValidStudents = a[1].filter(
        i => i.student !== 'Unknown' && isValidStudentName(i.student)
      ).length;
      if (aValidStudents !== bValidStudents)
        return bValidStudents - aValidStudents;
      return a[0].localeCompare(b[0]);
    })
    .forEach(([org, interns], index) => {
      summaryContent += `### ${index + 1}. ${org}`;

      // Add department if available
      const dept = interns[0].department;
      if (dept) {
        summaryContent += ` - *${dept}*`;
      }

      summaryContent += '\n';

      // List only valid students
      const validStudents = interns.filter(
        i => i.student !== 'Unknown' && isValidStudentName(i.student)
      );
      if (validStudents.length > 0) {
        summaryContent += 'Students:\n';
        // Remove duplicates
        const uniqueStudents = [...new Set(validStudents.map(s => s.student))];
        uniqueStudents.forEach(student => {
          summaryContent += `- ${student}\n`;
        });
      }

      summaryContent += '\n';
    });

  // Add section for internship categories
  summaryContent += `\n## Internship Categories:\n\n`;
  summaryContent += `- **Hospitality & Hotels**: Springhill Suites, Hotel Indigo, Hyatt Regency, Great Wolf Lodge, Chateau Elan\n`;
  summaryContent += `- **Food Service & Restaurants**: Chick-fil-A locations, 5&10 Restaurant, Ricardo's Kouzzina\n`;
  summaryContent += `- **Event Planning & Catering**: Epting Events, Trump's Catering, Proof of the Pudding, State Botanical Garden\n`;
  summaryContent += `- **Tourism & Entertainment**: Walt Disney World, Augusta National, Big Peach Running Co.\n`;
  summaryContent += `- **Academic & Non-Profit**: UGA Grady College, UGA Center for Continuing Education, The Chapel Athens\n`;

  // Save the summary
  fs.writeFileSync(
    path.join(docsDir, 'internship-summary.md'),
    summaryContent,
    'utf-8'
  );

  console.log(`\nExtraction Complete!`);
  console.log(`- Total internships found: ${uniqueInternships.length}`);
  console.log(`- Unique organizations: ${Object.keys(byOrganization).length}`);
  console.log(
    `- Students identified: ${
      uniqueInternships.filter(
        i => i.student !== 'Unknown' && isValidStudentName(i.student)
      ).length
    }`
  );
  console.log(`\nCreated: docs/internship-summary.md`);
}

// Run the extraction
processInternshipDocuments();
