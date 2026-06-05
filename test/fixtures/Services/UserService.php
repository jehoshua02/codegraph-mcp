<?php

namespace App\Services;

use App\Models\User;
use App\Repositories\UserRepository;

class UserService
{
    public function __construct(
        private readonly UserRepository $userRepo,
    ) {}

    public function getUser(int $id): ?User
    {
        return $this->userRepo->findById($id);
    }

    public function createUser(array $data): User
    {
        $user = new User();
        $user->save();
        return $user;
    }

    public function findByEmail(string $email): ?User
    {
        return User::findByEmail($email);
    }

    public function deactivate(User $user): void
    {
        $user->save();
    }

    public function checkRole(User $user): bool
    {
        return $user->hasRole('admin');
    }

    protected function validate(array $data): bool
    {
        return self::isValid($data);
    }

    private static function isValid(array $data): bool
    {
        return !empty($data);
    }
}
