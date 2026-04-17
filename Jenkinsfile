pipeline {
  agent {
    node {
      label 'dev-docker-ssh'
      customWorkspace '/home/jenkins/workspace/grejiji-pipeline'
    }
  }

  options {
    disableConcurrentBuilds()
    timestamps()
    buildDiscarder(logRotator(numToKeepStr: '20'))
  }

  environment {
    APP_NAME = 'grejiji-api'
    IMAGE_TAG = "${env.BUILD_NUMBER}-${env.GIT_COMMIT?.take(7) ?: 'local'}"
  }

  stages {
    stage('Checkout') {
      steps {
        checkout scm
      }
    }

    stage('Test Gate') {
      steps {
        sh '''
          docker run --rm \
            --user "$(id -u):$(id -g)" \
            -v "$PWD:/workspace" \
            -w /workspace \
            node:20-bookworm-slim \
            sh -lc "npm ci && npm test"
        '''
      }
    }

    stage('Build Docker Image') {
      steps {
        sh 'docker build -t ${APP_NAME}:${IMAGE_TAG} .'
      }
    }

    stage('Deploy Docker') {
      when {
        expression {
          return (env.DEPLOY_ENABLED ?: 'true') == 'true'
        }
      }
      steps {
        sh 'chmod +x ./scripts/jenkins/deploy-docker.sh'
        sh './scripts/jenkins/deploy-docker.sh'
      }
    }
  }

  post {
    always {
      sh 'docker image ls | head -n 20 || true'
    }
    success {
      echo 'Jenkins pipeline completed successfully.'
    }
    failure {
      echo 'Jenkins pipeline failed. Check stage logs and docker runtime output.'
    }
  }
}
