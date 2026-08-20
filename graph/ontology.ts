export type RelationshipCompatibility = {
  source: string;
  relationship: string;
  target: string;
};

export const RELATIONSHIP_COMPATIBILITY: RelationshipCompatibility[] = [
  { source: "Portfolio", relationship: "contains", target: "Project" },
  { source: "Portfolio", relationship: "governed_by", target: "Policy" },
  { source: "Project", relationship: "belongs_to", target: "Portfolio" },
  { source: "Project", relationship: "governed_by", target: "Policy" },
  { source: "Project", relationship: "uses", target: "Capability" },
  { source: "Project", relationship: "uses", target: "Factory" },
  { source: "Project", relationship: "uses", target: "Role" },
  { source: "Project", relationship: "uses", target: "Runtime" },
  { source: "Role", relationship: "requires", target: "Skill" },
  { source: "Role", relationship: "uses", target: "Integration" },
  { source: "Role", relationship: "provides", target: "Capability" },
  { source: "Skill", relationship: "implements", target: "Capability" },
  { source: "Integration", relationship: "authorizes", target: "Role" },
  { source: "Workflow", relationship: "uses", target: "Role" },
  { source: "Workflow", relationship: "requires", target: "Skill" },
  { source: "Workflow", relationship: "requires", target: "Capability" },
  { source: "Workflow", relationship: "uses", target: "Integration" },
  { source: "Workflow", relationship: "governed_by", target: "Policy" },
  { source: "Organization", relationship: "contains", target: "Division" },
  { source: "Organization", relationship: "owns", target: "Product" },
  { source: "Division", relationship: "belongs_to", target: "Organization" },
  { source: "Division", relationship: "owns", target: "Role" },
  { source: "Division", relationship: "owns", target: "Capability" },
  { source: "Division", relationship: "owns", target: "Product" },
  { source: "Product", relationship: "belongs_to", target: "Organization" },
  { source: "Product", relationship: "belongs_to", target: "Division" },
  { source: "Product", relationship: "uses", target: "Capability" },
  { source: "Product", relationship: "contains", target: "Project" },
  { source: "Capability", relationship: "belongs_to", target: "Division" },
  { source: "Capability", relationship: "uses", target: "Tool" },
  { source: "AgentDefinition", relationship: "instantiates", target: "Role" },
  { source: "AgentDefinition", relationship: "uses", target: "Skill" },
  { source: "AgentDefinition", relationship: "uses", target: "Tool" },
  { source: "AgentDefinition", relationship: "provides", target: "Capability" },
  { source: "AgentInstance", relationship: "instantiates", target: "AgentDefinition" },
  { source: "AgentInstance", relationship: "uses", target: "Runtime" },
  { source: "AgentInstance", relationship: "uses", target: "Tool" },
  { source: "AgentInstance", relationship: "uses", target: "Integration" },
  { source: "Runtime", relationship: "supports", target: "AgentDefinition" },
  { source: "Factory", relationship: "uses", target: "Workflow" },
  { source: "Factory", relationship: "uses", target: "Role" },
  { source: "Factory", relationship: "requires", target: "Capability" },
  { source: "WorkOrder", relationship: "belongs_to", target: "Project" },
  { source: "WorkOrder", relationship: "uses", target: "Factory" },
  { source: "WorkOrder", relationship: "uses", target: "AgentDefinition" },
  { source: "WorkOrder", relationship: "requires", target: "Capability" },
  { source: "WorkOrder", relationship: "governed_by", target: "Policy" },
  { source: "ExecutionRun", relationship: "executes", target: "WorkOrder" },
  { source: "ExecutionRun", relationship: "uses", target: "AgentInstance" },
  { source: "ExecutionRun", relationship: "uses", target: "Runtime" },
  { source: "ExecutionRun", relationship: "produces", target: "Artifact" },
  { source: "ExecutionRun", relationship: "produces", target: "Evidence" },
  { source: "Tool", relationship: "supplied_by", target: "Provider" },
  { source: "Tool", relationship: "uses", target: "Integration" },
  { source: "Provider", relationship: "supports", target: "Runtime" },
  { source: "Provider", relationship: "provides", target: "Tool" },
  { source: "Evidence", relationship: "validates", target: "Capability" },
  { source: "Evidence", relationship: "validates", target: "Artifact" },
  { source: "Evidence", relationship: "belongs_to", target: "ExecutionRun" },
  { source: "Verification", relationship: "validates", target: "Evidence" },
  { source: "Verification", relationship: "validates", target: "Artifact" },
  { source: "Verification", relationship: "validates", target: "Capability" },
  { source: "Artifact", relationship: "belongs_to", target: "ExecutionRun" },
  { source: "Decision", relationship: "belongs_to", target: "Project" },
  { source: "Decision", relationship: "governed_by", target: "Policy" },
  { source: "Constraint", relationship: "governed_by", target: "Policy" },
  { source: "Constraint", relationship: "governs", target: "Organization" },
  { source: "Constraint", relationship: "governs", target: "Division" },
  { source: "Constraint", relationship: "governs", target: "Product" },
  { source: "Constraint", relationship: "governs", target: "Project" },
  { source: "Constraint", relationship: "governs", target: "AgentDefinition" },
  { source: "Constraint", relationship: "governs", target: "Runtime" }
];

const compatibilityKeys = new Set(
  RELATIONSHIP_COMPATIBILITY.map(({ source, relationship, target }) => `${source}|${relationship}|${target}`)
);

export function isCompatibleRelationship(source: string, relationship: string, target: string): boolean {
  return compatibilityKeys.has(`${source}|${relationship}|${target}`);
}
