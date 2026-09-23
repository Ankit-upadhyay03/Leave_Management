export interface DesignationGroup {
  category: string;
  items: string[];
}

export const DESIGNATIONS: DesignationGroup[] = [
  {
    category: 'Intern & Trainee',
    items: [
      'Intern', 'Summer Intern', 'Graduate Engineer Trainee (GET)',
      'Management Trainee (MT)', 'Industrial Trainee', 'Apprentice',
    ]
  },
  {
    category: 'Associate & Entry Level',
    items: [
      'Associate', 'Junior Associate', 'Associate Software Engineer',
      'Executive', 'Executive Trainee',
    ]
  },
  {
    category: 'Software Development',
    items: [
      'Software Engineer', 'Senior Software Engineer', 'Full Stack Developer',
      'Frontend Developer', 'Backend Developer', 'Web Developer',
      'Mobile App Developer', 'Android Developer', 'iOS Developer',
      'Technical Architect', 'Solution Architect', 'Principal Engineer',
    ]
  },
  {
    category: 'AI & Data',
    items: [
      'AI Engineer', 'Machine Learning Engineer', 'NLP Engineer',
      'LLM Engineer', 'Computer Vision Engineer', 'MLOps Engineer',
      'Data Engineer', 'Data Scientist', 'Data Analyst', 'BI Engineer',
    ]
  },
  {
    category: 'Cloud & Infrastructure',
    items: [
      'Cloud Engineer', 'Cloud Architect', 'AWS Engineer', 'Azure Engineer',
      'DevOps Engineer', 'Site Reliability Engineer (SRE)',
      'Platform Engineer', 'Infrastructure Engineer',
    ]
  },
  {
    category: 'Cyber Security',
    items: [
      'Security Engineer', 'Security Analyst', 'SOC Analyst',
      'Penetration Tester', 'Security Consultant',
    ]
  },
  {
    category: 'Testing & QA',
    items: [
      'QA Engineer', 'Manual Tester', 'Automation Tester',
      'Performance Tester', 'SDET', 'Test Architect',
    ]
  },
  {
    category: 'Product',
    items: [
      'Associate Product Manager', 'Product Manager',
      'Senior Product Manager', 'Product Owner', 'Technical Product Manager',
    ]
  },
  {
    category: 'Design',
    items: [
      'UI Designer', 'UX Designer', 'UI/UX Designer',
      'Product Designer', 'Graphic Designer',
    ]
  },
  {
    category: 'Business Analysis',
    items: [
      'Business Analyst', 'Senior Business Analyst',
      'System Analyst', 'Functional Consultant',
    ]
  },
  {
    category: 'Human Resources',
    items: [
      'HR Executive', 'HR Generalist', 'Recruiter',
      'Talent Acquisition Specialist', 'Talent Acquisition Manager',
      'HR Business Partner', 'HR Manager',
    ]
  },
  {
    category: 'Finance',
    items: [
      'Accountant', 'Finance Executive', 'Financial Analyst',
      'Finance Manager', 'Chartered Accountant',
    ]
  },
  {
    category: 'Sales & Marketing - Sales',
    items: [
      'Sales Executive', 'Business Development Executive',
      'Business Development Associate', 'Account Manager', 'Sales Manager',
    ]
  },
  {
    category: 'Sales & Marketing - Marketing',
    items: [
      'Marketing Executive', 'Digital Marketing Executive',
      'SEO Specialist', 'Social Media Executive',
      'Marketing Manager', 'Brand Manager',
    ]
  },
  {
    category: 'Operations & Support - Operations',
    items: [
      'Operations Executive', 'Operations Analyst', 'Operations Manager',
    ]
  },
  {
    category: 'Operations & Support - Customer Support',
    items: [
      'Technical Support Engineer', 'Customer Support Executive',
      'Customer Success Manager',
    ]
  },
  {
    category: 'Team Leads',
    items: [
      'Team Lead', 'Technical Lead', 'Development Lead',
      'QA Lead', 'AI Lead', 'DevOps Lead',
    ]
  },
  {
    category: 'Managers',
    items: [
      'Assistant Manager', 'Deputy Manager', 'Manager', 'Senior Manager',
      'Engineering Manager', 'Project Manager', 'Program Manager',
      'Product Manager', 'Delivery Manager', 'Operations Manager',
      'HR Manager', 'Finance Manager', 'QA Manager',
    ]
  },
  {
    category: 'Department Heads',
    items: [
      'Head of Engineering', 'Head of AI', 'Head of Product',
      'Head of Operations', 'Head of HR', 'Head of Finance',
      'Head of Sales', 'Head of Marketing',
    ]
  },
  {
    category: 'Directors',
    items: [
      'Director', 'Senior Director', 'Engineering Director',
      'Product Director', 'HR Director', 'Finance Director',
      'Operations Director',
    ]
  },
];
