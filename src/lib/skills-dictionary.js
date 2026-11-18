/*
 * skills-dictionary.js — canonical skill names and their aliases.
 * Format: "Canonical|alias1|alias2". Aliases are matched case-insensitively on
 * word boundaries. Prefix an alias with "=" to make it case-sensitive (used for
 * short/ambiguous tokens like "Go", "R", "C").
 *
 * Users' own skills (from the Admin page) are matched too, even when they are
 * not in this list — so this only needs to cover common skills.
 */
(function () {
  'use strict';
  const AJP = globalThis.AJP;
  if (AJP.SKILLS) return;

  AJP.SKILLS = [
    // Languages
    'JavaScript|js|ecmascript|es6', 'TypeScript|ts', 'Python|python3', 'Java|j2ee|jee', 'C#|csharp|c sharp',
    'C++|cpp', 'C|=C', 'Go|golang|=Go', 'Rust', 'Ruby', 'PHP', 'Kotlin', 'Swift', 'Objective-C|objective c',
    'Scala', 'R|=R', 'MATLAB', 'Perl', 'Dart', 'Elixir', 'Haskell', 'Lua', 'Shell scripting|bash|shell script|zsh|powershell',
    'SQL|t-sql|tsql|pl/sql|plsql', 'HTML|html5', 'CSS|css3', 'Sass|scss', 'GraphQL', 'Solidity', 'COBOL', 'VBA',
    // Frontend
    'React|react.js|reactjs', 'Next.js|nextjs', 'Angular|angularjs', 'Vue.js|vue|vuejs', 'Svelte', 'Redux',
    'Tailwind CSS|tailwind', 'jQuery', 'Webpack', 'Vite', 'React Native', 'Flutter', 'Storybook',
    // Backend
    'Node.js|nodejs|node js', 'Express.js|express.js|expressjs', 'NestJS', 'Django', 'Flask', 'FastAPI',
    'Spring|spring boot|springboot|spring framework', '.NET|dotnet|asp.net|.net core', 'Ruby on Rails|rails',
    'Laravel', 'REST APIs|restful|rest api|rest apis|restful api|restful services|rest services|=REST', 'gRPC', 'Microservices|microservice|micro services|microservices architecture',
    'Kafka|apache kafka', 'RabbitMQ', 'WebSockets|websocket',
    // Data / DB
    'PostgreSQL|postgres|postgresql|psql', 'MySQL', 'SQL Server|mssql|microsoft sql server', 'Oracle Database|oracle db|oracle',
    'MongoDB|mongo', 'Redis', 'Elasticsearch|elastic search|opensearch|=ELK|elk stack', 'Cassandra', 'DynamoDB', 'Snowflake',
    'BigQuery', 'Redshift', 'Databricks', 'Apache Spark|spark|pyspark', 'Hadoop', 'Airflow|apache airflow',
    'dbt', 'ETL|elt', 'Data modeling|data modelling', 'Data warehousing|data warehouse', 'Pandas', 'NumPy',
    'Tableau', 'Power BI|powerbi', 'Looker', 'Excel|microsoft excel', 'Data analysis|data analytics|analyzing data|analysing data',
    'Statistics|statistical analysis',
    // AI / ML
    'Machine learning|ml|machine-learning models|ml models', 'Deep learning', 'TensorFlow', 'PyTorch', 'scikit-learn|sklearn', 'NLP|natural language processing',
    'Computer vision', 'LLMs|llm|large language models|large language model', 'Generative AI|genai|gen ai',
    'Prompt engineering', 'RAG|retrieval augmented generation|retrieval-augmented generation', 'MLOps',
    'LangChain', 'Hugging Face|huggingface',
    // Cloud / DevOps
    'AWS|amazon web services|=EC2|amazon ec2|amazon s3|cloudformation|=EKS|amazon eks', 'Azure|microsoft azure|azure devops|=AKS', 'GCP|google cloud|google cloud platform|=GKE|google kubernetes engine', 'Docker',
    'Kubernetes|k8s|openshift|=EKS|=AKS|=GKE|kubectl', 'Terraform', 'Ansible', 'Jenkins', 'GitHub Actions', 'GitLab CI|gitlab', 'CI/CD|ci cd|ci/cd pipelines|continuous integration|continuous delivery|continuous deployment|build pipelines|deployment pipelines',
    'Linux|unix', 'Serverless|aws lambda|lambda', 'Helm', 'Prometheus', 'Grafana', 'Datadog', 'Splunk',
    'Observability|monitoring', 'Networking|tcp/ip|dns', 'Infrastructure as Code|iac', 'SRE|site reliability',
    'Git|version control', 'Nginx',
    // Security
    'Cybersecurity|information security|infosec', 'IAM|identity and access management', 'OAuth|oauth2|oidc|openid connect',
    'SIEM', 'Penetration testing|pen testing|pentesting', 'SOC 2|soc2', 'Zero trust', 'Encryption|cryptography',
    // Testing / quality
    'Unit testing|unit tests|unit test', 'Test automation|automated testing', 'Selenium', 'Cypress', 'Playwright', 'Jest',
    'JUnit', 'pytest', 'TDD|test driven development|test-driven development', 'QA|quality assurance',
    // Architecture / practices
    'System design', 'Distributed systems|distributed computing|distributed architecture', 'Object-oriented programming|oop|object oriented|ood|object-oriented design', 'Design patterns',
    'Data structures|algorithms', 'Performance optimization|performance tuning', 'Scalability', 'API design',
    'Event-driven architecture|event driven', 'Domain-driven design|ddd',
    // Product / delivery / business
    'Agile|scrum|kanban', 'Jira', 'Confluence', 'Project management', 'Product management', 'Program management',
    'Stakeholder management|stakeholders', 'Requirements gathering|business requirements', 'Roadmapping|roadmap',
    'A/B testing|ab testing|experimentation', 'Product analytics', 'UX design|user experience', 'UI design|user interface design',
    'Figma', 'User research', 'Salesforce', 'SAP', 'ServiceNow', 'HubSpot', 'CRM', 'ERP', 'SEO', 'Google Analytics',
    'Digital marketing', 'Content marketing', 'Financial modeling|financial modelling', 'Budgeting|forecasting',
    'Accounting|gaap', 'Six Sigma|lean six sigma', 'PMP', 'ITIL',
    // Soft / leadership
    'Leadership|team lead|tech lead|technical leadership|technical lead|lead a team|led a team|leading teams', 'People management|managing teams|direct reports|people manager|team management|managed a team|manage a team|line management', 'Mentoring|mentorship|coaching',
    'Communication|communication skills|written and verbal|verbal and written|communicator', 'Cross-functional collaboration|cross-functional|cross functional',
    'Problem solving|problem-solving', 'Presentation skills|presentations', 'Negotiation', 'Customer service|customer support',
    // Certifications
    'AWS Certified|aws certification', 'CISSP', 'CPA', 'CFA', 'Certified Scrum Master|csm',
  ];

  /*
   * Synonyms beyond aliases.
   * IMPLIES: having the key skill means you have these too (full credit): Next.js → React → JavaScript.
   * SIMILAR: interchangeable-ish skills; having one gives HALF credit for another in the same group, and the
   * gap chip says "you have X" (AWS ↔ Azure ↔ GCP). Keep groups tight: only skills a recruiter would accept
   * as transferable with a short ramp-up.
   */
  AJP.SKILL_IMPLIES = {
    'Next.js': ['React'], 'React Native': ['React'], Redux: ['React'], React: ['JavaScript'], 'Vue.js': ['JavaScript'], Svelte: ['JavaScript'],
    Angular: ['TypeScript'], TypeScript: ['JavaScript'], 'Node.js': ['JavaScript'], 'Express.js': ['Node.js'], NestJS: ['Node.js', 'TypeScript'],
    jQuery: ['JavaScript'], Django: ['Python'], Flask: ['Python'], FastAPI: ['Python'], Pandas: ['Python'], NumPy: ['Python'], pytest: ['Python', 'Unit testing'],
    'scikit-learn': ['Machine learning', 'Python'], PyTorch: ['Deep learning'], TensorFlow: ['Deep learning'], 'Deep learning': ['Machine learning'],
    'Hugging Face': ['Machine learning'], LangChain: ['LLMs'], RAG: ['LLMs'], 'Prompt engineering': ['LLMs'], 'Computer vision': ['Machine learning'], NLP: ['Machine learning'],
    Spring: ['Java'], JUnit: ['Java', 'Unit testing'], 'Ruby on Rails': ['Ruby'], Laravel: ['PHP'], '.NET': ['C#'], Jest: ['JavaScript', 'Unit testing'],
    PostgreSQL: ['SQL'], MySQL: ['SQL'], 'SQL Server': ['SQL'], 'Oracle Database': ['SQL'], dbt: ['SQL'],
    Snowflake: ['SQL', 'Data warehousing'], BigQuery: ['SQL', 'GCP', 'Data warehousing'], Redshift: ['SQL', 'AWS', 'Data warehousing'], DynamoDB: ['AWS'],
    Helm: ['Kubernetes'], Terraform: ['Infrastructure as Code'], 'GitHub Actions': ['CI/CD', 'Git'], 'GitLab CI': ['CI/CD', 'Git'], Jenkins: ['CI/CD'],
    Prometheus: ['Observability'], Grafana: ['Observability'], Datadog: ['Observability'], Splunk: ['Observability'],
    Selenium: ['Test automation'], Cypress: ['Test automation'], Playwright: ['Test automation'], TDD: ['Unit testing'],
    'Tailwind CSS': ['CSS'], Sass: ['CSS'], 'AWS Certified': ['AWS'], 'Certified Scrum Master': ['Agile'], 'People management': ['Leadership'],
    'Apache Spark': ['Distributed systems'], Kafka: ['Event-driven architecture'],
  };
  AJP.SKILL_SIMILAR = [
    ['AWS', 'Azure', 'GCP'],
    ['PostgreSQL', 'MySQL', 'SQL Server', 'Oracle Database'],
    ['MongoDB', 'DynamoDB', 'Cassandra'],
    ['Snowflake', 'BigQuery', 'Redshift', 'Databricks'],
    ['React', 'Angular', 'Vue.js', 'Svelte'],
    ['Django', 'Flask', 'FastAPI'],
    ['Kafka', 'RabbitMQ'],
    ['Jenkins', 'GitHub Actions', 'GitLab CI'],
    ['Prometheus', 'Datadog', 'Splunk'],
    ['Tableau', 'Power BI', 'Looker'],
    ['TensorFlow', 'PyTorch'],
    ['Selenium', 'Cypress', 'Playwright'],
    ['Java', 'Kotlin', 'Scala'],
  ];
})();
