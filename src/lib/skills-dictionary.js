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
    'Laravel', 'REST APIs|restful|rest api|rest apis|restful api|=REST', 'gRPC', 'Microservices|microservice',
    'Kafka|apache kafka', 'RabbitMQ', 'WebSockets|websocket',
    // Data / DB
    'PostgreSQL|postgres', 'MySQL', 'SQL Server|mssql|microsoft sql server', 'Oracle Database|oracle db|oracle',
    'MongoDB|mongo', 'Redis', 'Elasticsearch|elastic search|opensearch', 'Cassandra', 'DynamoDB', 'Snowflake',
    'BigQuery', 'Redshift', 'Databricks', 'Apache Spark|spark|pyspark', 'Hadoop', 'Airflow|apache airflow',
    'dbt', 'ETL|elt', 'Data modeling|data modelling', 'Data warehousing|data warehouse', 'Pandas', 'NumPy',
    'Tableau', 'Power BI|powerbi', 'Looker', 'Excel|microsoft excel', 'Data analysis|data analytics',
    'Statistics|statistical analysis',
    // AI / ML
    'Machine learning|ml', 'Deep learning', 'TensorFlow', 'PyTorch', 'scikit-learn|sklearn', 'NLP|natural language processing',
    'Computer vision', 'LLMs|llm|large language models|large language model', 'Generative AI|genai|gen ai',
    'Prompt engineering', 'RAG|retrieval augmented generation|retrieval-augmented generation', 'MLOps',
    'LangChain', 'Hugging Face|huggingface',
    // Cloud / DevOps
    'AWS|amazon web services', 'Azure|microsoft azure', 'GCP|google cloud|google cloud platform', 'Docker',
    'Kubernetes|k8s', 'Terraform', 'Ansible', 'Jenkins', 'GitHub Actions', 'GitLab CI|gitlab', 'CI/CD|ci cd|continuous integration|continuous delivery|continuous deployment',
    'Linux|unix', 'Serverless|aws lambda|lambda', 'Helm', 'Prometheus', 'Grafana', 'Datadog', 'Splunk',
    'Observability|monitoring', 'Networking|tcp/ip|dns', 'Infrastructure as Code|iac', 'SRE|site reliability',
    'Git|version control', 'Nginx',
    // Security
    'Cybersecurity|information security|infosec', 'IAM|identity and access management', 'OAuth|oauth2|oidc|openid connect',
    'SIEM', 'Penetration testing|pen testing|pentesting', 'SOC 2|soc2', 'Zero trust', 'Encryption|cryptography',
    // Testing / quality
    'Unit testing|unit tests', 'Test automation|automated testing', 'Selenium', 'Cypress', 'Playwright', 'Jest',
    'JUnit', 'pytest', 'TDD|test driven development|test-driven development', 'QA|quality assurance',
    // Architecture / practices
    'System design', 'Distributed systems', 'Object-oriented programming|oop|object oriented', 'Design patterns',
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
    'Leadership|team lead|tech lead', 'People management|managing teams|direct reports', 'Mentoring|mentorship|coaching',
    'Communication|communication skills|written and verbal', 'Cross-functional collaboration|cross-functional|cross functional',
    'Problem solving|problem-solving', 'Presentation skills|presentations', 'Negotiation', 'Customer service|customer support',
    // Certifications
    'AWS Certified|aws certification', 'CISSP', 'CPA', 'CFA', 'Certified Scrum Master|csm',
  ];
})();
