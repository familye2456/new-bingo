# Requirements Document

## Introduction

This document specifies requirements for adding an "agent" role to the fidel-bingo system. The agent role enables hierarchical user management where agents can create and manage their own players, but cannot access users created by other agents or admins. Agents are strictly restricted from viewing, modifying, deleting, or performing any operation on users with role='admin' or role='agent'. Admin users are completely invisible and inaccessible to agents. This provides a multi-tenant-like capability within the existing admin interface.

## Glossary

- **System**: The fidel-bingo application (backend and frontend)
- **Agent**: A user with role='agent' who can create and manage players
- **Admin**: A user with role='admin' who has full system access
- **Player**: A user with role='player' who plays bingo games
- **Operator**: A user with role='operator' (existing role, unchanged)
- **User_Repository**: The TypeORM repository for User entities
- **Auth_Middleware**: Express middleware that handles authentication and authorization
- **Admin_UI**: The React-based administrative interface
- **Created_By_Field**: A nullable foreign key column tracking which user created another user

## Requirements

### Requirement 1: Agent Role Definition

**User Story:** As a system administrator, I want to define an agent role, so that I can delegate user management to trusted partners.

#### Acceptance Criteria

1. THE System SHALL add 'agent' to the UserRole enum type definition
2. THE User_Repository SHALL accept 'agent' as a valid role value
3. THE System SHALL treat agents as distinct from admins, players, and operators

### Requirement 2: User Creation Tracking

**User Story:** As the system, I want to track who created each user, so that agents can only manage their own users.

#### Acceptance Criteria

1. THE User entity SHALL include a Created_By_Field that references the User table
2. THE Created_By_Field SHALL be nullable to support existing users
3. WHEN a user creates another user, THE System SHALL automatically set the Created_By_Field to the creator's user ID
4. WHEN an existing user has Created_By_Field equal to null, THE System SHALL treat them as visible to all admins and agents

### Requirement 3: Agent Authorization

**User Story:** As an agent, I want to access the admin interface, so that I can manage my users.

#### Acceptance Criteria

1. THE Auth_Middleware SHALL accept 'agent' role for routes that currently accept 'admin' role
2. WHEN an agent accesses a protected route, THE System SHALL grant access if the route allows agent role
3. THE System SHALL route authenticated agents to the /admin path

### Requirement 4: User List Filtering

**User Story:** As an agent, I want to see only the players I created, so that I cannot interfere with other agents' users or access admin accounts.

#### Acceptance Criteria

1. WHEN an agent requests the user list, THE System SHALL return only users where Created_By_Field equals the agent's user ID and role is 'player'
2. WHEN an agent requests the user list, THE System SHALL include users where Created_By_Field is null and role is 'player'
3. WHEN an agent requests the user list, THE System SHALL exclude all users with role='admin' from the results
4. WHEN an agent requests the user list, THE System SHALL exclude all users with role='agent' from the results
5. WHEN an admin requests the user list, THE System SHALL return all users regardless of Created_By_Field value
6. THE System SHALL filter users at the database query level, not in application code

### Requirement 5: User Creation by Agents

**User Story:** As an agent, I want to create player accounts, so that I can onboard my customers.

#### Acceptance Criteria

1. WHEN an agent creates a user, THE System SHALL set the new user's role to 'player'
2. WHEN an agent creates a user, THE System SHALL set the Created_By_Field to the agent's user ID
3. THE System SHALL prevent agents from creating users with role='agent'
4. THE System SHALL prevent agents from creating users with role='admin'
5. THE System SHALL prevent agents from creating users with role='operator'

### Requirement 6: User Modification Restrictions

**User Story:** As an agent, I want to modify my users' details, so that I can keep their information current.

#### Acceptance Criteria

1. WHEN an agent attempts to modify a user, THE System SHALL verify the target user's role is 'player'
2. IF the target user has role='admin', THEN THE System SHALL reject the modification with a 403 Forbidden error
3. IF the target user has role='agent', THEN THE System SHALL reject the modification with a 403 Forbidden error
4. IF the target user has role='operator', THEN THE System SHALL reject the modification with a 403 Forbidden error
5. WHEN an agent attempts to modify a player, THE System SHALL verify the user's Created_By_Field equals the agent's user ID or is null
6. IF the Created_By_Field does not match the agent's user ID AND is not null, THEN THE System SHALL reject the modification with a 403 Forbidden error

### Requirement 7: Balance Management by Agents

**User Story:** As an agent, I want to manage my users' balances, so that I can handle their payments.

#### Acceptance Criteria

1. WHEN an agent performs a balance operation on a user, THE System SHALL verify the target user's role is 'player'
2. IF the target user has role='admin', THEN THE System SHALL reject the balance operation with a 403 Forbidden error
3. IF the target user has role='agent', THEN THE System SHALL reject the balance operation with a 403 Forbidden error
4. WHEN an agent performs a balance operation on a player, THE System SHALL verify the user's Created_By_Field equals the agent's user ID or is null
5. IF the Created_By_Field verification fails, THEN THE System SHALL reject the balance operation with a 403 Forbidden error
6. THE System SHALL apply the same prepaid/postpaid rules for agents as for admins

### Requirement 8: User Activation Control

**User Story:** As an agent, I want to activate and deactivate my users, so that I can control access.

#### Acceptance Criteria

1. WHEN an agent attempts to activate or deactivate a user, THE System SHALL verify the target user's role is 'player'
2. IF the target user has role='admin', THEN THE System SHALL reject the status change with a 403 Forbidden error
3. IF the target user has role='agent', THEN THE System SHALL reject the status change with a 403 Forbidden error
4. WHEN an agent attempts to activate or deactivate a player, THE System SHALL verify the user's Created_By_Field equals the agent's user ID or is null
5. IF the Created_By_Field verification fails, THEN THE System SHALL reject the status change with a 403 Forbidden error

### Requirement 9: User Deletion by Agents

**User Story:** As an agent, I want to delete my users, so that I can remove inactive accounts.

#### Acceptance Criteria

1. WHEN an agent attempts to delete a user, THE System SHALL verify the target user's role is 'player'
2. IF the target user has role='admin', THEN THE System SHALL reject the deletion with a 403 Forbidden error
3. IF the target user has role='agent', THEN THE System SHALL reject the deletion with a 403 Forbidden error
4. WHEN an agent attempts to delete a player, THE System SHALL verify the user's Created_By_Field equals the agent's user ID or is null
5. IF the Created_By_Field verification fails, THEN THE System SHALL reject the deletion with a 403 Forbidden error
6. WHEN an agent deletes a player, THE System SHALL delete all related data following the same cascade rules as admin deletions

### Requirement 10: Cartela Management by Agents

**User Story:** As an agent, I want to assign and remove cartelas for my users, so that they can play games.

#### Acceptance Criteria

1. WHEN an agent performs a cartela operation on a user, THE System SHALL verify the target user's role is 'player'
2. IF the target user has role='admin', THEN THE System SHALL reject the cartela operation with a 403 Forbidden error
3. IF the target user has role='agent', THEN THE System SHALL reject the cartela operation with a 403 Forbidden error
4. WHEN an agent performs a cartela operation on a player, THE System SHALL verify the user's Created_By_Field equals the agent's user ID or is null
5. IF the Created_By_Field verification fails, THEN THE System SHALL reject the cartela operation with a 403 Forbidden error

### Requirement 11: Agent Creation by Admins

**User Story:** As an admin, I want to create agent accounts, so that I can delegate user management.

#### Acceptance Criteria

1. WHEN an admin creates a user with role='agent', THE System SHALL create the agent account
2. THE System SHALL set the agent's Created_By_Field to the admin's user ID
3. THE System SHALL prevent players and operators from creating agents
4. THE System SHALL prevent agents from creating other agents

### Requirement 12: Admin UI Role Display

**User Story:** As an agent, I want to see my role in the interface, so that I understand my permissions.

#### Acceptance Criteria

1. WHEN an agent views the Admin_UI sidebar, THE System SHALL display "Agent" instead of "Administrator"
2. WHEN an admin views the Admin_UI sidebar, THE System SHALL display "Administrator"
3. THE System SHALL use the authenticated user's role to determine the display text

### Requirement 13: Transaction History Access

**User Story:** As an agent, I want to view my users' transaction history, so that I can track their activity.

#### Acceptance Criteria

1. WHEN an agent requests a user's transactions, THE System SHALL verify the target user's role is 'player'
2. IF the target user has role='admin', THEN THE System SHALL reject the request with a 403 Forbidden error
3. IF the target user has role='agent', THEN THE System SHALL reject the request with a 403 Forbidden error
4. WHEN an agent requests transactions for a player, THE System SHALL verify the user's Created_By_Field equals the agent's user ID or is null
5. IF the Created_By_Field verification fails, THEN THE System SHALL reject the request with a 403 Forbidden error
6. THE System SHALL return transactions in the same format for agents as for admins

### Requirement 14: User Detail View Access

**User Story:** As an agent, I want to view detailed information about my users, so that I can support them.

#### Acceptance Criteria

1. WHEN an agent requests a user's detail page, THE System SHALL verify the target user's role is 'player'
2. IF the target user has role='admin', THEN THE System SHALL reject the request with a 403 Forbidden error
3. IF the target user has role='agent', THEN THE System SHALL reject the request with a 403 Forbidden error
4. WHEN an agent requests a player's detail page, THE System SHALL verify the user's Created_By_Field equals the agent's user ID or is null
5. IF the Created_By_Field verification fails, THEN THE System SHALL reject the request with a 403 Forbidden error
6. THE Admin_UI SHALL display the same user detail interface for agents as for admins

### Requirement 15: Frontend Route Protection

**User Story:** As an agent, I want to access the admin routes, so that I can use the management interface.

#### Acceptance Criteria

1. WHEN an agent authenticates, THE System SHALL redirect them to /admin
2. THE System SHALL allow agents to access all routes under /admin
3. THE System SHALL prevent agents from accessing player-only routes
4. THE System SHALL use the same AdminLayout component for agents as for admins
