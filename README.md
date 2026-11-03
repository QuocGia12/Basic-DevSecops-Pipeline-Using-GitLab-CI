# Pipeline DevSecOps cơ bản sử dụng GitLab CI 
## 1. Tổng quan 
Dự án này trình bày một pipeline CI/CD DevSecOps cơ bản sử dụng GitLab CI. Pipeline tích hợp các hoạt động kiểm thử bảo mật vào quy trình phát triển và triển khai phần mềm, bao gồm các stage SAST, build image, scan image, push image và deploy 

Dự án sử dụng ứng dụng Frontend có tên SecDocs để minh họa toàn bộ quy trình CI/CD, từ quản lý mã nguồn đến xây dựng, kiểm thử bảo mật và triển khai ứng dụng.
## 2. Kiến trúc 
2 server:
- Build Server: chạy SAST, build image, scan image và push image lên registry
- Deploy Server: pull docker image từ registry và run image đó 

Nếu muốn môi trường giống doanh nghiệp hơn thì sử dụng thêm:
- internal GitLab server 
- internal registry server: portus, harbor, .... 

## 3. Pipeline 
Chú ý rằng pipeline hiện tại sử dụng `only: tags`, vì thế chỉ được trigger khi có tags được tạo, các commit thông thường sẽ không trigger pipeline 

Pipeline: 
- SAST → chạy trên build server: clone code về, sử dụng trivy để thực hiện scan source code, kết quả scan `SAST_REPORT` được lưu trong GitLab artifact 
- Build → chạy trên build server: thực hiện build image  
- Image scan → chạy trên build server: sử dụng trivy để scan image vừa build, kết quả `IMAGE_SCAN_REPORT` được lưu trong GitLab artifact 
- Push image → chạy trên build server: login vào registry, push image vừa build lên registry, logout khỏi registry 
- Deploy → chạy trên deploy server: login vào registry, pull image vừa push đó, run container sử dụng image đó, logout khỏi registry 



## 4. Cách chạy pipeline 
### 4.1. Register GitLab runner 
Register 2 gitlab runners:
- `secdocs-build-shell`: trên build server → thực hiện các stage: `sast`, `build`, `image_scan`, `push` 
- `secdocs-dev-shell`: trên deploy server → thực hiện stage deploy 
### 4.2. Tạo các biến trên setting CI CD của Group/Project GitLab tương ứng 
- `REGISTRY_HOST`: hostname của registry, ví dụ `docker.io`
- `REGISTRY_USER`: username sử dụng trong registry 
- `REGISTRY_PASSWORD`: password tương ứng với username đó, chú ý bật chế độ `Masked` để log chứa `REGISTRY_PASSWORD` được masked 
- `FE_PORT`: port mapping `<host port>:<container port>`, trong trường hợp chạy project frontend `secdocs` với container port là 80 thì sử dụng `<host port>:80`
### 4.3. Config permission trên Build Server: 
- Thêm user `gitlab-runner` vào group docker → để thực hiện docker build, tag, push: `sudo usermod -aG docker gitlab-runner`

### 4.4. Config permission trên Deploy Server 
- Thêm user `gitlab-runner` vào group docker → để thực hiện docker pull, rm, run: `sudo usermod -aG docker gitlab-runner`

> Chú ý: user trong group docker có quyền gần như root, vì thế lưu ý rằng bất kỳ ai sửa `.gitlab-ci.yml` đều có thể chạy lệnh tùy ý với quyền rất cao, và với shell executor thì các lệnh được thực hiện trực tiếp trên server 


### 4.5. Push source code và tạo tag 
- Push source code và `.gitlab-ci.yml` lên project tương ứng 
- Tạo tag và quan sát pipeline chạy 

```bash
# Add source code
git add .

# Commit changes
git commit -m "Initial commit"

# Push source code
git push origin main

# Create and push tag
git tag v1.0.0
git push origin v1.0.0
```



## 5. Security Testing 

Hiện tại, pipeline thực hiện hai bước kiểm tra bảo mật:

- SAST: Sử dụng Trivy để scan source code, phát hiện vulnerabilities, secrets và misconfigurations.
- Image Scan: Sử dụng Trivy để scan Docker image sau khi build, phát hiện các vulnerabilities trong image.

Kết quả của mỗi bước scan được lưu thành file `.txt` và upload lên GitLab CI/CD Artifacts để phục vụ việc kiểm tra và đánh giá.

Lưu ý về cơ chế kiểm soát pipeline:

Ở phiên bản hiện tại, pipeline mới chỉ thực hiện security scanning và lưu lại kết quả. Việc phát hiện security issues chưa được sử dụng làm điều kiện để quyết định pipeline có được tiếp tục hay không.

Do đó:

- Nếu kết quả scan có vulnerabilities, pipeline vẫn tiếp tục thực hiện các stage tiếp theo.
- Các stage `build`, `image_scan`, `push` và `deploy` chưa được kiểm soát dựa trên mức độ nghiêm trọng của kết quả scan.

Hướng phát triển:

Có thể bổ sung cơ chế Security Gate bằng cách cấu hình Trivy trả về exit code khác `0` khi phát hiện các vấn đề bảo mật vượt quá ngưỡng cho phép.

Ví dụ:

```
trivy fs \
  --scanners vuln,secret,misconfig \
  --exit-code 1 \
  /scan
```

Khi đó:

- Nếu kết quả scan đạt yêu cầu, job chuyển sang trạng thái `Passed` và pipeline tiếp tục.
- Nếu kết quả scan không đạt yêu cầu, job chuyển sang trạng thái `Failed` và GitLab tự động dừng các stage tiếp theo.
