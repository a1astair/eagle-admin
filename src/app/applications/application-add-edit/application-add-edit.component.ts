import { Component, OnInit, OnDestroy, ViewChild } from '@angular/core';
import { Router, ActivatedRoute, ParamMap } from '@angular/router';
import { Response } from '@angular/http/src/static_response';
import { DialogService } from 'ng2-bootstrap-modal';
import { Subscription } from 'rxjs/Subscription';
import { Subject } from 'rxjs/Subject';
import * as moment from 'moment-timezone';
import * as _ from 'lodash';

import { Constants } from 'app/utils/constants';
import { AppComponent } from 'app/app.component';
import { SelectOrganizationComponent } from '../select-organization/select-organization.component';
import { Application } from 'app/models/application';
import { Document } from 'app/models/document';
import { Organization } from 'app/models/organization';
import { ApiService } from 'app/services/api';
import { DocumentService } from 'app/services/document.service';
import { ApplicationService } from 'app/services/application.service';
import { OrganizationService } from 'app/services/organization.service';

@Component({
  selector: 'app-application-add-edit',
  templateUrl: './application-add-edit.component.html',
  styleUrls: ['./application-add-edit.component.scss']
})
export class ApplicationAddEditComponent implements OnInit, OnDestroy {
  @ViewChild('fileInput') fileInput;
  public loading: boolean;
  public application: Application;
  public applicationDocuments: Document[];
  private sub: Subscription;
  public types: string[];
  public subtypes: {};
  public purposes: string[];
  public subpurposes: {};
  public statuses: string[];
  public error: boolean;
  public status: string;
  public showMsg: boolean;
  public clFile: number;
  public changedFiles: string;
  private ngUnsubscribe: Subject<boolean> = new Subject<boolean>();

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private api: ApiService,
    private documentService: DocumentService,
    private orgService: OrganizationService,
    private applicationService: ApplicationService,
    private dialogService: DialogService
  ) {
    this.applicationDocuments = [];
    this.types = Constants.types;
    this.subtypes = Constants.subtypes;
    this.purposes = Constants.purposes;
    this.subpurposes = Constants.subpurposes;
    this.statuses = Constants.statuses;
    this.showMsg = false;
    this.clFile = null;
  }

  typeChange(obj) {
    this.application.subtype = Constants.subtypes[obj][0];
  }

  purposeChange(obj) {
    this.application.subpurpose = Constants.subpurposes[obj][0];
  }

  selectClient() {
    const self = this;
    let orgId = null;
    if (this.application.proponent) {
      orgId = this.application.proponent._id;
    }
    this.dialogService.addDialog(SelectOrganizationComponent,
      {
        selectedOrgId: orgId
      }, {
        backdropColor: 'rgba(0, 0, 0, 0.5)'
      })
      .takeUntil(this.ngUnsubscribe)
      .subscribe((selectedOrgId) => {
        if (selectedOrgId) {
          // Fetch the org from the service, and bind to this instance of an application.
          self.orgService.getById(selectedOrgId)
            .subscribe(
              data => {
                self.application.proponent = new Organization(data);
                // Update current reference.
                self.application._proponent = data._id;
              },
              error => {
                console.log('error:', error);
              });
        } else {
          console.log('org selection cancelled.');
        }
      });
  }

  addCLFile() {
    if (this.application.cl_files === null) {
      this.application.cl_files = [];
    }
    this.application.cl_files.push(this.clFile);
    this.clFile = null;
  }

  removeCLFile(clFile) {
    _.remove(this.application.cl_files, function (item) {
      return (item === clFile);
    });
  }

  showMessage(isError, msg) {
    this.error = isError;
    this.showMsg = true;
    this.status = msg;
    setTimeout(() => this.showMsg = false, 5000);
  }

  onSubmit() {
    // Adjust for current tz
    this.application.projectDate = moment(this.application.projectDate).format();

    const self = this;
    this.api.saveApplication(this.application)
      .subscribe(
        (data: any) => {
          // console.log('Saved application', data);
          self.showMessage(false, 'Saved Application');
        },
        error => {
          console.log('ERR:', error);
          self.showMessage(true, 'Error saving application');
        });
  }

  upload() {
    const self = this;
    const fileBrowser = this.fileInput.nativeElement;
    console.log('Uploading files:', fileBrowser.files);
    _.each(fileBrowser.files, function (file) {
      if (file) {
        const formData = new FormData();
        formData.append('_application', self.application._id);
        formData.append('displayName', file.name);
        formData.append('upfile', file);
        self.api.uploadDocument(formData)
          .subscribe(
            res => {
              // do stuff w/my uploaded file
              console.log('RES:', res.json());
              self.applicationDocuments.push(res.json());
            },
            error => {
              console.log('error:', error);
            });
      }
    });
  }

  removeDocument(document: Document) {
    const self = this;
    this.api.deleteDocument(document)
      .subscribe(res => {
        const doc = res.json();
        // In-memory removal on successful delete.
        _.remove(self.applicationDocuments, function (item) {
          return (item._id === doc._id);
        });
      });
  }

  publishDocument(document: Document) {
    const self = this;
    this.api.publishDocument(document)
      .subscribe(res => {
        const doc = res.json();
        const f = _.find(self.applicationDocuments, function (item) {
          return (item._id === doc._id);
        });
        f.isPublished = true;
      });
  }

  unPublishDocument(document: Document) {
    const self = this;
    this.api.unPublishDocument(document)
      .subscribe(res => {
        const doc = res.json();
        const f = _.find(self.applicationDocuments, function (item) {
          return (item._id === doc._id);
        });
        f.isPublished = false;
      });
  }

  publishApplication(app: Application): Subscription {
    return this.applicationService.publish(app);
  }

  unPublishApplication(app: Application): Subscription {
    return this.applicationService.unPublish(app);
  }

  deleteApplication(app: Application): Subscription {
    return this.applicationService.deleteApplication(app)
      .subscribe(res => {
        this.router.navigate(['/applications']);
      });
  }

  onChange(event: any, input: any) {
    const files = [].slice.call(event.target.files);
    input.value = files.map(f => f.name).join(', ');
  }

  ngOnInit() {
    // If we're not logged in, redirect.
    if (!this.api.ensureLoggedIn()) {
      return; // return false;
    }

    this.loading = true;
    const self = this;

    // wait for the resolver to retrieve the application details from back-end
    this.sub = this.route.data
      // .finally(() => this.loading = false) // TODO: make this work
      .subscribe(
        (data: { application: Application }) => {
          this.loading = false;
          this.application = data.application;
          if (!this.application.projectDate) {
            this.application.projectDate = new Date();
          }
          this.application.projectDate = moment(this.application.projectDate).format();
          // application not found --> navigate back to application list
          if (!this.application || !this.application._id) {
            console.log('Application not found!');
            this.router.navigate(['/applications']);
          }

          this.documentService.getAllByApplicationId(this.application._id)
            .subscribe((docs: Document[]) => {
              this.applicationDocuments = docs;
            });

          if (self.application._proponent) {
            this.orgService.getById(self.application._proponent)
              .subscribe((o: Organization) => {
                self.application.proponent = new Organization(o);
              });
          }
        },
        error => {
          this.loading = false;
          // If 403, redir to /login.
          if (error.startsWith('403')) {
            this.router.navigate(['/login']);
          }
          alert('Error loading application');
        });
  }

  ngOnDestroy() {
    this.ngUnsubscribe.next();
    this.ngUnsubscribe.complete();
  }
}
